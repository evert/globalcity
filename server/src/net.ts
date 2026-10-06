// WebSocket + HTTP server: protocol handling (shared/protocol.ts), subscriptions, tile update
// batching, leaderboard pushes, static client hosting and /health.
//
// Dev hooks (only when the server runs with DEV_HOOKS=1, see index.ts): the non-protocol socket
// message {t:'devIgnite', x, y} ignites tile (x,y) as a random outbreak would (whole building ->
// rubble + one fire tile); {t:'devFunds', amount} adds money. Any other time these messages are
// silently dropped like any unknown message.

import http from 'node:http';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import {
  WORLD_W, WORLD_H, CHUNK, CHUNKS_X, CHUNKS_Y, MAX_SUBSCRIBED_CHUNKS, TOOLS, LEADERBOARD_PUSH_TICKS,
  PRESENCE_INTERVAL_MS, PRESENCE_MAX,
  encodeChunk, inWorld, clamp,
  type ClientMsg, type ServerMsg, type ToolId, type Presence,
  overviewClass, OVERVIEW_CHUNK_BYTES, parseChunkKey,
  LIFELINE_AMOUNT, LIFELINE_MAX_FUNDS, LIFELINE_EARLY_PEAK_POP, LIFELINE_MAX_DEBT,
} from '@globalcity/shared';
import { World, chunkIndex, chunkCoords, type ChunkIndex } from './world.ts';
import { Players, NAMES_LOCKED_MSG, sanitizeName, sanitizeCityName, refreshMilestoneStats, refreshLifeline, type PlayerRecord } from './players.ts';
import { Sim, type TickResult } from './sim.ts';
import { applyBuild, queryTile } from './tools.ts';
import { Leaderboard } from './leaderboard.ts';
import { log } from './util.ts';
import { Admin, type Announcement } from './admin.ts';

// Clients paint at most one build per 25 ms (40/s); allow headroom above that so painting is never throttled.
const BUILD_RATE_PER_SEC = 60;
const BUILD_BURST = 90;
const VIEW_RATE_PER_SEC = 10;
/** a 'view' older than this no longer appears in presence frames */
const PRESENCE_STALE_MS = 10_000;
const MAX_ZOOM = 64;

interface View { x: number; y: number; zoom: number; cx?: number; cy?: number; at: number }

interface Client {
  ws: WebSocket;
  player: PlayerRecord | null;
  subs: Set<ChunkIndex>;
  buildTokens: number;
  lastRefill: number;
  /** last time a "building too fast" toast was sent (ms) */
  droppedAt: number;
  viewTokens: number;
  viewRefill: number;
  lastStatsJson: string;
  /** client build version from hello ('' = an old client without version support) */
  clientVersion: string;
  /** last camera/cursor report from this socket */
  view: View | null;
  /** last presence frame sent was empty (so an empty one is not repeated) */
  presenceEmpty: boolean;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

const ROOT_FILES: Record<string, { file: string; type: string }> = {
  '/ATTRIBUTION.md': { file: 'ATTRIBUTION.md', type: 'text/markdown; charset=utf-8' },
  '/LICENSE': { file: 'LICENSE', type: 'text/plain; charset=utf-8' },
};

export interface NetOptions {
  /** accept dev-only messages such as devIgnite (never in production) */
  devHooks?: boolean;
  /** save directory (admin token lives there) */
  dataDir?: string;
}

export class Net {
  private readonly clients = new Set<Client>();
  private httpServer: http.Server | null = null;
  private presenceTimer: NodeJS.Timeout | null = null;
  readonly admin: Admin;
  private readonly leaderboard: Leaderboard;
  private readonly devHooks: boolean;

  constructor(
    private readonly world: World,
    private readonly players: Players,
    private readonly sim: Sim,
    private readonly clientDist: string,
    private readonly repoRoot: string,
    opts: NetOptions = {},
  ) {
    this.devHooks = opts.devHooks ?? false;
    world.buildings.onChange = (op, b) => this.broadcast({ t: 'building', op, b });
    this.admin = new Admin(clientDist, opts.dataDir ?? path.join(repoRoot, 'data/save'),
      (v) => this.broadcast({ t: 'version', version: v }),
      (a) => { for (const c of this.clients) if (c.player) this.sendAnnouncement(c, a); });
    this.leaderboard = new Leaderboard(players);
    if (this.devHooks) log('DEV_HOOKS enabled: devIgnite/devFunds/devTraffic/devPeak/devRailLink/devPlace accepted');
  }

  private get buildCtx(): { world: World; players: Players; railCitiesAt: (x: number, y: number) => number } {
    return { world: this.world, players: this.players, railCitiesAt: (x, y) => this.sim.railCitiesAt(x, y) };
  }

  listen(port: number, host: string): Promise<void> {
    const server = http.createServer((req, res) => this.handleHttp(req, res));
    const wss = new WebSocketServer({ server, path: '/ws' });
    wss.on('connection', (ws) => this.onConnection(ws));
    this.httpServer = server;
    this.presenceTimer = setInterval(() => this.presenceTick(), PRESENCE_INTERVAL_MS);
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => { server.off('error', reject); resolve(); });
    });
  }

  close(): void {
    if (this.presenceTimer) { clearInterval(this.presenceTimer); this.presenceTimer = null; }
    for (const c of this.clients) c.ws.close(1001, 'server shutting down');
    this.httpServer?.close();
  }

  onlineCount(): number {
    const ids = new Set<string>();
    for (const c of this.clients) if (c.player) ids.add(c.player.id);
    return ids.size;
  }

  // ---------------------------------------------------------------------------
  // HTTP: /health, static client build with index.html fallback
  // ---------------------------------------------------------------------------
  // Zoomed-out map view: every claimed chunk as one class byte per tile, gzipped, cached for 10 s.
  private overviewCache: { at: number; gz: Buffer; raw: Buffer } | null = null;
  private serveOverview(req: http.IncomingMessage, res: http.ServerResponse): void {
    const now = Date.now();
    if (!this.overviewCache || now - this.overviewCache.at > 10_000) {
      const keys = [...this.players.claims.keys()];
      const raw = Buffer.alloc(2 + keys.length * OVERVIEW_CHUNK_BYTES);
      raw.writeUInt16LE(keys.length, 0);
      let o = 2;
      for (const key of keys) {
        const { cx, cy } = parseChunkKey(key);
        raw.writeUInt16LE(cx, o); raw.writeUInt16LE(cy, o + 2);
        const view = this.world.chunkView(cx, cy);
        for (let i = 0; i < view.length; i++) raw[o + 4 + i] = overviewClass(view[i]);
        o += OVERVIEW_CHUNK_BYTES;
      }
      this.overviewCache = { at: now, raw, gz: zlib.gzipSync(raw, { level: 6 }) };
    }
    const gzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
    const body = gzip ? this.overviewCache.gz : this.overviewCache.raw;
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': body.length,
      'cache-control': 'no-cache',
      ...(gzip ? { 'content-encoding': 'gzip' } : {}),
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  private handleHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (this.admin.handle(req, res, url.pathname)) return;
    if (url.pathname === '/overview.bin') { this.serveOverview(req, res); return; }
    if (url.pathname === '/health') {
      const body = JSON.stringify({
        online: this.onlineCount(),
        players: this.players.players.size,
        claims: this.players.claims.size,
        tick: this.sim.tickCount,
      });
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(body);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    // Licensing files live at the repo root; the client links to /ATTRIBUTION.md.
    const rootFile = ROOT_FILES[url.pathname];
    if (rootFile) { this.serveFile(req, res, path.join(this.repoRoot, rootFile.file), rootFile.type); return; }
    if (!fs.existsSync(this.clientDist)) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('GlobalCity server is running, but no client build was found (client/dist). Run `npm run build` or use the Vite dev server.');
      return;
    }
    let pathname: string;
    try { pathname = decodeURIComponent(url.pathname); } catch { res.writeHead(400); res.end(); return; }
    let file = path.resolve(this.clientDist, '.' + pathname);
    if (!file.startsWith(this.clientDist)) { res.writeHead(403); res.end(); return; }
    let st = statOrNull(file);
    if (st?.isDirectory()) { file = path.join(file, 'index.html'); st = statOrNull(file); }
    if (!st) {
      // SPA fallback for extension-less routes.
      if (path.extname(pathname) === '') { file = path.join(this.clientDist, 'index.html'); st = statOrNull(file); }
      if (!st) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); return; }
    }
    const ext = path.extname(file).toLowerCase();
    this.serveFile(req, res, file, MIME[ext] ?? 'application/octet-stream', ext === '.html' ? 'no-cache' : 'public, max-age=3600');
  }

  private serveFile(req: http.IncomingMessage, res: http.ServerResponse, file: string, type: string, cache = 'no-cache'): void {
    const st = statOrNull(file);
    if (!st || !st.isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); return; }
    res.writeHead(200, { 'content-type': type, 'content-length': st.size, 'cache-control': cache });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  }

  // ---------------------------------------------------------------------------
  // WebSocket
  // ---------------------------------------------------------------------------
  private onConnection(ws: WebSocket): void {
    const client: Client = {
      ws, player: null, subs: new Set(), buildTokens: BUILD_BURST, lastRefill: Date.now(), droppedAt: 0, clientVersion: '',
      viewTokens: VIEW_RATE_PER_SEC, viewRefill: Date.now(), lastStatsJson: '', view: null, presenceEmpty: true,
    };
    this.clients.add(client);
    ws.on('message', (data: RawData, isBinary: boolean) => {
      if (isBinary) return;
      let raw: unknown;
      try { raw = JSON.parse(data.toString()); } catch { return; }
      if (this.devHooks && client.player && this.onDevMessage(client, raw)) return;
      const msg = parseClientMsg(raw);
      if (msg) this.onMessage(client, msg);
    });
    ws.on('close', () => {
      if (client.player) { client.player.lastSeen = Date.now(); this.players.dirty = true; }
      this.clients.delete(client);
    });
    ws.on('error', () => { /* close follows */ });
  }

  private send(client: Client, msg: ServerMsg): void {
    if (client.ws.readyState === WebSocket.OPEN) client.ws.send(JSON.stringify(msg));
  }

  private broadcast(msg: ServerMsg): void {
    const s = JSON.stringify(msg);
    for (const c of this.clients) if (c.player && c.ws.readyState === WebSocket.OPEN) c.ws.send(s);
  }

  private toast(client: Client, msg: string, kind: 'info' | 'error' | 'success', at?: { x: number; y: number }): void {
    this.send(client, at ? { t: 'toast', msg, kind, at } : { t: 'toast', msg, kind });
  }

  /** Dev-only messages (DEV_HOOKS=1). Returns true if `raw` was handled. */
  private onDevMessage(client: Client, raw: unknown): boolean {
    if (typeof raw !== 'object' || raw === null) return false;
    const m = raw as Record<string, unknown>;
    if (m.t === 'devIgnite') {
      if (isInt(m.x) && isInt(m.y) && inWorld(m.x, m.y)) {
        const lit = this.sim.ignite(m.x, m.y);
        this.toast(client, lit ? `devIgnite: fire started at ${m.x},${m.y}` : `devIgnite: ${m.x},${m.y} is not burnable`, 'info', { x: m.x, y: m.y });
        log(`devIgnite ${m.x},${m.y} by ${client.player?.name}: ${lit ? 'ignited' : 'not burnable'}`);
      }
      return true;
    }
    if (m.t === 'devSetFunds') {
      // {t:'devSetFunds', amount}: set this player's funds (lifeline tests)
      const p = client.player;
      if (p && isInt(m.amount) && m.amount >= 0) { p.funds = m.amount; p.stats.funds = m.amount; refreshLifeline(p); this.players.dirty = true; this.sendStatsIfChanged(client); }
      return true;
    }
    if (m.t === 'devPeak') {
      // {t:'devPeak', pop}: raise this player's peak population (milestone tests)
      const p = client.player;
      if (p && isInt(m.pop) && m.pop >= 0) { p.peakPop = Math.max(p.peakPop ?? 0, m.pop); refreshMilestoneStats(p); this.players.dirty = true; this.sendStatsIfChanged(client); }
      return true;
    }
    if (m.t === 'devRailLink') {
      // {t:'devRailLink'}: mark this player's rail as having reached a neighbour (Grand Central tests)
      const p = client.player;
      if (p) { p.railLinked = true; refreshMilestoneStats(p); this.players.dirty = true; this.sendStatsIfChanged(client); }
      return true;
    }
    if (m.t === 'devPlace') {
      // {t:'devPlace', tool, x, y}: place a building ignoring milestone rules (simulates pre-milestone cities)
      const p = client.player;
      if (p && typeof m.tool === 'string' && m.tool in TOOLS && isInt(m.x) && isInt(m.y)) {
        const r = applyBuild(this.buildCtx, p, m.tool as ToolId, m.x, m.y, { ignoreMilestones: true });
        this.toast(client, r.ok ? `devPlace ${m.tool} ok` : `devPlace failed: ${r.msg}`, r.ok ? 'info' : 'error');
        this.scheduleFlush();
      }
      return true;
    }
    if (m.t === 'devTraffic') {
      // {t:'devTraffic', x, y, amount} adds traffic density to a road tile (tests the traffic pipeline
      // without building a city big enough to jam its roads)
      if (isInt(m.x) && isInt(m.y) && inWorld(m.x, m.y) && isInt(m.amount) && m.amount > 0 && m.amount <= 255) this.sim.devTraffic(m.x, m.y, m.amount);
      return true;
    }
    if (m.t === 'devFunds') {
      const p = client.player;
      if (p && isInt(m.amount) && m.amount > 0 && m.amount <= 100_000_000) {
        p.funds += m.amount;
        p.stats.funds = p.funds;
        this.players.dirty = true;
        this.sendStatsIfChanged(client);
        this.toast(client, `devFunds: +$${m.amount}`, 'info');
        log(`devFunds +${m.amount} for ${p.name}`);
      }
      return true;
    }
    return false;
  }

  private sendStatsIfChanged(client: Client): void {
    if (!client.player) return;
    const json = JSON.stringify(client.player.stats);
    if (json === client.lastStatsJson) return;
    client.lastStatsJson = json;
    if (client.ws.readyState === WebSocket.OPEN) client.ws.send(`{"t":"stats","stats":${json}}`);
  }

  private onMessage(client: Client, msg: ClientMsg): void {
    if (msg.t === 'hello') { this.onHello(client, msg); return; }
    const p = client.player;
    if (!p) return; // ignore everything before hello
    this.players.touch(p);
    switch (msg.t) {
      case 'ping': this.send(client, { t: 'pong' }); break;
      case 'leaderboard': this.send(client, this.leaderboard.messageFor(p)); break;
      case 'sub': this.onSub(client, msg.chunks); break;
      case 'claim': this.onClaim(client, p, msg.cx, msg.cy); break;
      case 'build': this.onBuild(client, p, msg.tool, msg.x, msg.y); break;
      case 'view': this.onView(client, msg); break;
      case 'query':
        if (inWorld(msg.x, msg.y)) this.send(client, { t: 'query', info: queryTile(this.buildCtx, msg.x, msg.y) });
        break;
      case 'findFree': {
        const spot = this.players.findFree(msg.cx, msg.cy);
        this.send(client, spot ? { t: 'freeSpot', cx: spot.cx, cy: spot.cy } : { t: 'freeSpot', cx: null, cy: null });
        break;
      }
      case 'rename': {
        const name = sanitizeName(msg.name);
        if (!name) { this.toast(client, 'Invalid name', 'error'); break; }
        if (!this.players.rename(p, name)) { this.toast(client, NAMES_LOCKED_MSG, 'error'); break; }
        this.broadcast({ t: 'claims', claims: this.players.claimInfosOf(p) });
        this.toast(client, `You are now ${name}`, 'success');
        break;
      }
      case 'lifeline': {
        refreshLifeline(p);
        if (!p.stats.lifelineAvailable) {
          const owed = p.debt ?? 0;
          this.toast(client, owed > 0 && (p.peakPop ?? 0) >= LIFELINE_EARLY_PEAK_POP ? 'Repay your current lifeline first'
            : owed > 0 && owed + LIFELINE_AMOUNT > LIFELINE_MAX_DEBT ? `You already owe $${owed.toLocaleString('en-US')}: the limit is $${LIFELINE_MAX_DEBT.toLocaleString('en-US')}`
            : p.chunks.length === 0 ? 'Claim a plot first' : `A lifeline is only for cities with less than $${LIFELINE_MAX_FUNDS.toLocaleString('en-US')}`, 'error');
          break;
        }
        p.funds += LIFELINE_AMOUNT; p.stats.funds = p.funds; p.debt = (p.debt ?? 0) + LIFELINE_AMOUNT;
        refreshLifeline(p); this.players.dirty = true;
        log(`${p.name} (${p.cityName}) took a $${LIFELINE_AMOUNT} lifeline`);
        this.toast(client, `🛟 Lifeline: $${LIFELINE_AMOUNT.toLocaleString('en-US')} added. It is repaid from a quarter of each month's surplus.`, 'success');
        this.sendStatsIfChanged(client);
        break;
      }
      case 'renameCity': {
        const name = sanitizeCityName(msg.name);
        if (!name) { this.toast(client, 'Invalid city name', 'error'); break; }
        const r = this.players.renameCity(p, name);
        if (!r.ok) { this.toast(client, r.msg, 'error'); break; }
        if (p.chunks.length > 0) this.broadcast({ t: 'claims', claims: this.players.claimInfosOf(p) });
        this.toast(client, `Your city is now called ${name}`, 'success');
        log(`${p.name} renamed their city to ${name}`);
        break;
      }
    }
  }

  /** Camera/cursor report: rate-limited per socket, clamped to the world, shown to others via presence frames. */
  private onView(client: Client, msg: Extract<ClientMsg, { t: 'view' }>): void {
    const now = Date.now();
    client.viewTokens = Math.min(VIEW_RATE_PER_SEC, client.viewTokens + ((now - client.viewRefill) / 1000) * VIEW_RATE_PER_SEC);
    client.viewRefill = now;
    if (client.viewTokens < 1) return;
    client.viewTokens -= 1;
    const view: View = {
      x: clamp(Math.round(msg.x * 10) / 10, 0, WORLD_W - 1),
      y: clamp(Math.round(msg.y * 10) / 10, 0, WORLD_H - 1),
      zoom: clamp(Math.round(msg.zoom * 100) / 100, 0.01, MAX_ZOOM),
      at: now,
    };
    if (msg.cx !== undefined && msg.cy !== undefined) {
      view.cx = clamp(Math.floor(msg.cx), 0, WORLD_W - 1);
      view.cy = clamp(Math.floor(msg.cy), 0, WORLD_H - 1);
    }
    client.view = view;
  }

  /** Every PRESENCE_INTERVAL_MS: tell each socket where the other recently-active players are looking. */
  private presenceTick(): void {
    const now = Date.now();
    const active: { id: string; presence: Presence }[] = [];
    for (const c of this.clients) {
      const p = c.player, v = c.view;
      if (!p || !v || now - v.at > PRESENCE_STALE_MS || c.ws.readyState !== WebSocket.OPEN) continue;
      const presence: Presence = { id: p.id, name: p.name, cityName: p.cityName, color: p.color, x: v.x, y: v.y, zoom: v.zoom };
      if (v.cx !== undefined && v.cy !== undefined) { presence.cx = v.cx; presence.cy = v.cy; }
      active.push({ id: p.id, presence });
      if (active.length >= PRESENCE_MAX + 1) break; // +1: one entry may be the receiver itself
    }
    for (const c of this.clients) {
      if (!c.player || c.ws.readyState !== WebSocket.OPEN) continue;
      const players: Presence[] = [];
      for (const a of active) {
        if (a.id === c.player.id) continue;
        players.push(a.presence);
        if (players.length >= PRESENCE_MAX) break;
      }
      if (players.length === 0 && c.presenceEmpty) continue;
      c.presenceEmpty = players.length === 0;
      this.send(c, { t: 'presence', players });
    }
  }

  private onHello(client: Client, msg: Extract<ClientMsg, { t: 'hello' }>): void {
    if (client.player) return;
    let p = this.players.resume(msg.id, msg.token);
    if (!p) p = this.players.create(sanitizeName(msg.name));
    client.player = p;
    client.clientVersion = msg.v ?? '';
    if (p.chunks.length > 0) this.sim.initMilestones(p); // a returning mayor of a frozen city sees correct unlocks at once
    client.lastStatsJson = JSON.stringify(p.stats);
    this.send(client, {
      t: 'welcome',
      player: { ...this.players.publicOf(p), token: p.token },
      stats: p.stats,
      world: { w: WORLD_W, h: WORLD_H, chunk: CHUNK },
      claims: this.players.allClaims(),
      online: this.onlineCount(),
      time: { ...this.players.time },
    });
    this.send(client, this.leaderboard.messageFor(p));
    this.send(client, this.airportsMsg());
    this.send(client, this.shippingMsg());
    this.send(client, { t: 'buildings', list: this.world.buildings.list() });
    if (this.admin.version) this.send(client, { t: 'version', version: this.admin.version });
    if (p.notice) { this.toast(client, p.notice, 'info'); delete p.notice; this.players.dirty = true; }
    const ann = this.admin.active();
    if (ann) this.sendAnnouncement(client, ann);
    log(`${p.name} (${p.id.slice(0, 8)}) connected; online=${this.onlineCount()}`);
  }

  private onSub(client: Client, chunks: [number, number][]): void {
    const next = new Set<ChunkIndex>();
    for (const [cx, cy] of chunks) {
      if (next.size >= MAX_SUBSCRIBED_CHUNKS) break;
      next.add(chunkIndex(clamp(Math.floor(cx), 0, CHUNKS_X - 1), clamp(Math.floor(cy), 0, CHUNKS_Y - 1)));
    }
    for (const ci of next) {
      if (client.subs.has(ci)) continue;
      const { cx, cy } = chunkCoords(ci);
      if (client.ws.readyState === WebSocket.OPEN) client.ws.send(encodeChunk(cx, cy, this.world.chunkView(cx, cy)));
    }
    client.subs = next;
  }

  private onClaim(client: Client, p: PlayerRecord, cx: number, cy: number): void {
    const r = this.players.claim(p, cx, cy);
    if (!r.ok) { this.toast(client, r.msg, 'error'); return; }
    this.broadcast({ t: 'claim', claim: this.players.claimInfo(cx, cy, p) });
    this.toast(client, r.cost > 0 ? `Claimed chunk ${cx},${cy} for $${r.cost}` : `Welcome, Mayor! You founded your city at chunk ${cx},${cy}`, 'success');
    this.sendStatsIfChanged(client);
    log(`${p.name} claimed ${cx},${cy} (cost ${r.cost})`);
  }

  private onBuild(client: Client, p: PlayerRecord, tool: ToolId, x: number, y: number): void {
    // Token-bucket rate limit per socket.
    const now = Date.now();
    client.buildTokens = Math.min(BUILD_BURST, client.buildTokens + ((now - client.lastRefill) / 1000) * BUILD_RATE_PER_SEC);
    client.lastRefill = now;
    if (client.buildTokens < 1) {
      // Say so (at most every 2 s) instead of silently dropping the build.
      if (now - client.droppedAt > 2000) { client.droppedAt = now; this.toast(client, 'Building too fast; some tiles were skipped', 'info'); }
      return;
    }
    client.buildTokens -= 1;

    const r = applyBuild(this.buildCtx, p, tool, x, y);
    if (!r.ok) { this.toast(client, r.msg, r.kind); return; }
    if (r.msg) this.toast(client, r.msg, 'info', { x, y });
    this.sendStatsIfChanged(client);
    this.scheduleFlush();
  }

  // ---------------------------------------------------------------------------
  // Periodic work driven by index.ts
  // ---------------------------------------------------------------------------

  /**
   * Flush tile changes as soon as the current batch of incoming messages has been handled, so a build
   * shows up within one round-trip instead of waiting for the next periodic flush (TILE_FLUSH_MS).
   */
  private flushScheduled = false;
  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    setImmediate(() => { this.flushScheduled = false; this.flushTiles(); });
  }

  /** Send pending tile updates to each socket, filtered to its subscribed chunks. */
  flushTiles(): void {
    const pending = this.world.pending;
    if (pending.size === 0) return;
    for (const c of this.clients) {
      if (!c.player || c.subs.size === 0 || c.ws.readyState !== WebSocket.OPEN) continue;
      const u: number[] = [];
      for (const [ci, arr] of pending) {
        if (!c.subs.has(ci)) continue;
        for (let i = 0; i < arr.length; i++) u.push(arr[i]);
      }
      if (u.length > 0) c.ws.send(JSON.stringify({ t: 'tiles', u } satisfies ServerMsg));
    }
    pending.clear();
  }

  /** New clients get a banner; old clients (no version in hello) only understand toasts. */
  private sendAnnouncement(c: Client, a: Announcement | null): void {
    if (c.clientVersion) { this.send(c, a ? { t: 'announce', ...a } : { t: 'announceClear' }); return; }
    if (a) this.toast(c, `📣 ${a.msg}`, a.level === 'warn' ? 'error' : 'info');
  }

  /** last airports list sent to clients (JSON), so we only broadcast when it changes */
  private airportsJson = '[]';
  private airportsMsg(): ServerMsg { return { t: 'airports', airports: this.sim.airports, now: Date.now() }; }
  private shippingVersion = -1;
  private shippingMsg(): ServerMsg { return { t: 'shipping', ports: this.sim.shipping.ports, routes: this.sim.shipping.routes, now: Date.now() }; }

  afterTick(result: TickResult): void {
    this.broadcast({ t: 'time', time: result.time, online: this.onlineCount() });
    const aj = JSON.stringify(this.sim.airports);
    if (aj !== this.airportsJson) { this.airportsJson = aj; this.broadcast(this.airportsMsg()); }
    if (this.sim.shipping.version !== this.shippingVersion) { this.shippingVersion = this.sim.shipping.version; this.broadcast(this.shippingMsg()); }
    for (const u of result.unclaimed) this.broadcast({ t: 'unclaim', cx: u.cx, cy: u.cy });
    if (result.claimsChanged.length > 0) this.broadcast({ t: 'claims', claims: result.claimsChanged });
    for (const c of this.clients) this.sendStatsIfChanged(c);
    for (const t of result.toasts) {
      for (const c of this.clients) if (c.player?.id === t.playerId) this.toast(c, t.msg, t.kind, t.at);
    }
    // Leaderboard: recompute every N ticks (or when a city was released); push to everyone (with their own rank) only when the top list changed.
    if ((result.unclaimed.length > 0 || this.sim.tickCount % LEADERBOARD_PUSH_TICKS === 0) && this.leaderboard.recompute()) {
      for (const c of this.clients) if (c.player) this.send(c, this.leaderboard.messageFor(c.player));
    }
    this.flushTiles();
  }
}

function statOrNull(file: string): fs.Stats | null {
  try { return fs.statSync(file); } catch { return null; }
}

// ---------------------------------------------------------------------------
// Strict parsing of client messages: anything malformed is dropped.
// ---------------------------------------------------------------------------
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => Number.isInteger(v);

function parseClientMsg(raw: unknown): ClientMsg | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  switch (m.t) {
    case 'hello': {
      const out: ClientMsg = { t: 'hello' };
      if (typeof m.id === 'string') out.id = m.id;
      if (typeof m.token === 'string') out.token = m.token;
      if (typeof m.name === 'string') out.name = m.name;
      if (typeof m.v === 'string') out.v = m.v.slice(0, 64);
      return out;
    }
    case 'sub': {
      if (!Array.isArray(m.chunks)) return null;
      const chunks: [number, number][] = [];
      for (const c of m.chunks as unknown[]) {
        if (Array.isArray(c) && c.length === 2 && isNum(c[0]) && isNum(c[1])) chunks.push([c[0], c[1]]);
      }
      return { t: 'sub', chunks };
    }
    case 'claim': return isInt(m.cx) && isInt(m.cy) ? { t: 'claim', cx: m.cx, cy: m.cy } : null;
    case 'findFree': return isNum(m.cx) && isNum(m.cy) ? { t: 'findFree', cx: m.cx, cy: m.cy } : null;
    case 'query': return isInt(m.x) && isInt(m.y) ? { t: 'query', x: m.x, y: m.y } : null;
    case 'build':
      return typeof m.tool === 'string' && m.tool in TOOLS && isInt(m.x) && isInt(m.y)
        ? { t: 'build', tool: m.tool as ToolId, x: m.x, y: m.y }
        : null;
    case 'rename': return typeof m.name === 'string' ? { t: 'rename', name: m.name } : null;
    case 'renameCity': return typeof m.name === 'string' ? { t: 'renameCity', name: m.name } : null;
    case 'view': {
      if (!isNum(m.x) || !isNum(m.y) || !isNum(m.zoom)) return null;
      const out: ClientMsg = { t: 'view', x: m.x, y: m.y, zoom: m.zoom };
      if (isNum(m.cx) && isNum(m.cy)) { out.cx = m.cx; out.cy = m.cy; }
      return out;
    }
    case 'leaderboard': return { t: 'leaderboard' };
    case 'lifeline': return { t: 'lifeline' };
    case 'ping': return { t: 'ping' };
    default: return null;
  }
}
