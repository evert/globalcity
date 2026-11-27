// The test client: one WebSocket mayor that keeps what the server tells it (stats, claims, toasts, the chunks it
// subscribed to with their tile updates, ...), plus the helpers every test uses: wait for something, find a free
// dry site, build, reset the server between test files.
import WebSocket from 'ws';
import { inject } from 'vitest';
import {
  CHUNK,
  LOMASK,
  chunkOf,
  chunkKey,
  decodeChunk,
  isWater,
  type ActiveDisaster,
  type AirportInfo,
  type ClaimInfo,
  type ClientMsg,
  type CustomBuilding,
  type PlayerStats,
  type Presence,
  type QueryInfo,
  type SantaTree,
  type ServerMsg,
  type ToolId,
} from '@globalcity/shared';

declare module 'vitest' {
  interface ProvidedContext {
    /** one server per worker (VITEST_POOL_ID 1..n), see global-setup.ts */
    servers: { port: number; log: string; dataDir: string }[];
    tickMs: number;
  }
}

/** The server this worker plays on. */
export function server(): { port: number; log: string; dataDir: string } {
  const servers = inject('servers');
  const s = servers[(Number(process.env.VITEST_POOL_ID) || 1) - 1];
  if (!s) throw new Error(`no test server for worker ${process.env.VITEST_POOL_ID} (${servers.length} booted)`);
  return s;
}
export const wsUrl = (): string => `ws://127.0.0.1:${server().port}/ws`;
export const httpUrl = (): string => `http://127.0.0.1:${server().port}`;

/** One simulation step, in ms (the servers run TICK_MS=500 and a month per step). */
export const TICK = inject('tickMs');
/** Long enough for n ticks to have happened. */
export const ticks = (n: number): number => n * TICK + 500;
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Poll `pred` every 20 ms until it returns something truthy; reject after `ms`. */
export function waitFor<T>(pred: () => T | null | undefined | false, label: string, ms = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const check = (): void => {
      let v: T | null | undefined | false;
      try {
        v = pred();
      } catch (e) {
        reject(e);
        return;
      }
      if (v) resolve(v);
      else if (Date.now() - t0 > ms) reject(new Error(`timed out after ${ms} ms waiting for ${label}`));
      else setTimeout(check, 20);
    };
    check();
  });
}

/** Settings the tests change (server/src/config.ts). */
export interface TestConfig {
  seasonMonth: number | null;
  abandonDayMs: number;
  cityFreezeMs: number;
  smallCityReleaseMs: number;
  regrowMs: number;
  regrowP: number;
  monumentMinPop: number;
  disasterEveryMs: number;
}

/** Send one dev message on a socket of its own (no 'hello') and wait for its reply. */
async function devCall(msg: object): Promise<{ ok: boolean; error?: string } & Record<string, unknown>> {
  const ws = new WebSocket(wsUrl());
  try {
    await new Promise<void>((res, rej) => {
      ws.once('open', res);
      ws.once('error', rej);
    });
    const t = (msg as { t: string }).t;
    const reply = new Promise<{ ok: boolean; error?: string }>((res, rej) => {
      const timer = setTimeout(() => rej(new Error(`no reply to ${t}`)), 10_000);
      ws.on('message', (d, bin) => {
        if (bin) return;
        const m = JSON.parse(d.toString());
        if (m.t === t) {
          clearTimeout(timer);
          res(m);
        }
      });
    });
    ws.send(JSON.stringify(msg));
    return await reply;
  } finally {
    ws.close();
  }
}

/**
 * Start a test file on a server as good as freshly booted on an empty save (devReset), with these settings
 * (devConfig; anything not given is the server's default). Closes every client of the previous file.
 */
export async function resetServer(cfg: Partial<TestConfig> = {}): Promise<void> {
  await closeAll();
  const r = await devCall({ t: 'devReset' });
  if (!r.ok) throw new Error(`devReset failed: ${r.error} (server log: ${server().log})`);
  if (Object.keys(cfg).length) {
    const c = await devCall({ t: 'devConfig', ...cfg });
    if (!c.ok) throw new Error(`devConfig failed: ${c.error}`);
  }
}

/** Change settings mid-file (devConfig); returns them all. */
export async function configure(cfg: Partial<TestConfig>): Promise<TestConfig> {
  const c = await devCall({ t: 'devConfig', ...cfg });
  if (!c.ok) throw new Error(`devConfig failed: ${c.error}`);
  return c.config as TestConfig;
}

const open = new Set<TestClient>();
/** Close every client (between test files; also done by resetServer). */
export async function closeAll(): Promise<void> {
  await Promise.all([...open].map((c) => c.close()));
}

export interface Toast {
  kind: 'info' | 'error' | 'success';
  msg: string;
  at?: { x: number; y: number };
  big?: boolean;
}

export class TestClient {
  ws!: WebSocket;
  id = '';
  token = '';
  cityName = '';
  welcome: Extract<ServerMsg, { t: 'welcome' }> | null = null;
  welcomes = 0;
  stats: PlayerStats | null = null;
  /** 'stats' messages received */
  statsCount = 0;
  toasts: Toast[] = [];
  /** subscribed chunks by chunk key, kept up to date from 'tiles' */
  chunks = new Map<string, Uint32Array>();
  /** tile updates received (x, y, v triples), in or out of a known chunk */
  tileUpdates = 0;
  /** every claim this client knows about, by chunk key (welcome + 'claim' + 'claims' - 'unclaim') */
  claims = new Map<string, ClaimInfo>();
  unclaims: string[] = [];
  presence: { at: number; players: Presence[] }[] = [];
  queries: QueryInfo[] = [];
  freeSpot: { cx: number | null; cy: number | null } | null = null;
  buildings: CustomBuilding[] | null = null;
  /** 'building' messages as "add university 10,20" */
  buildingEvents: string[] = [];
  built: { seq: number; ok: boolean }[] = [];
  disasters: ActiveDisaster[] | null = null;
  airports: AirportInfo[] | null = null;
  santa: { trees: SantaTree[]; now: number }[] = [];
  leaderboard: Extract<ServerMsg, { t: 'leaderboard' }> | null = null;
  worldStats: Extract<ServerMsg, { t: 'worldStats' }>['stats'] | null = null;
  time: Extract<ServerMsg, { t: 'time' }> | null = null;
  /** every JSON message, in order */
  log: ServerMsg[] = [];
  closeCode: number | null = null;

  constructor(readonly name: string) {}

  /** Connect and say hello (as a new mayor, or as `resume`'s); resolves on 'welcome'. */
  static async connect(name: string, opts: { v?: string; resume?: { id: string; token: string } } = {}): Promise<TestClient> {
    const c = new TestClient(name);
    await c.open(opts);
    return c;
  }

  private async open(opts: { v?: string; resume?: { id: string; token: string } }): Promise<void> {
    this.ws = new WebSocket(wsUrl());
    this.ws.binaryType = 'arraybuffer';
    open.add(this);
    await new Promise<void>((res, rej) => {
      this.ws.once('open', res);
      this.ws.once('error', rej);
    });
    this.ws.on('message', (d, bin) => this.onMessage(d as ArrayBuffer | Buffer, bin));
    this.ws.on('close', (code) => {
      this.closeCode = code;
      open.delete(this);
    });
    const n = this.welcomes;
    this.send({ t: 'hello', name: this.name, ...(opts.v ? { v: opts.v } : {}), ...opts.resume });
    await waitFor(() => this.welcomes > n, `welcome for ${this.name}`);
  }

  private onMessage(d: ArrayBuffer | Buffer, bin: boolean): void {
    if (bin) {
      const ab = d instanceof ArrayBuffer ? d : (d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) as ArrayBuffer);
      const c = decodeChunk(ab);
      if (c) this.chunks.set(chunkKey(c.cx, c.cy), c.tiles);
      return;
    }
    const m = JSON.parse(d.toString()) as ServerMsg;
    this.log.push(m);
    switch (m.t) {
      case 'welcome':
        this.welcome = m;
        this.id = m.player.id;
        this.token = m.player.token;
        this.cityName = m.player.cityName;
        this.stats = m.stats;
        for (const c of m.claims) this.claims.set(chunkKey(c.cx, c.cy), c);
        this.welcomes++;
        break;
      case 'stats':
        this.stats = m.stats;
        this.statsCount++;
        break;
      case 'toast':
        this.toasts.push({ kind: m.kind, msg: m.msg, at: m.at, big: m.big });
        break;
      case 'freeSpot':
        this.freeSpot = m;
        break;
      case 'claim':
        this.claims.set(chunkKey(m.claim.cx, m.claim.cy), m.claim);
        break;
      case 'claims':
        for (const c of m.claims) this.claims.set(chunkKey(c.cx, c.cy), c);
        break;
      case 'unclaim':
        this.claims.delete(chunkKey(m.cx, m.cy));
        this.unclaims.push(chunkKey(m.cx, m.cy));
        break;
      case 'presence':
        this.presence.push({ at: Date.now(), players: m.players });
        break;
      case 'query':
        this.queries.push(m.info);
        break;
      case 'buildings':
        this.buildings = m.list;
        break;
      case 'building':
        this.buildingEvents.push(`${m.op} ${m.b.kind} ${m.b.x},${m.b.y}`);
        break;
      case 'built':
        this.built.push({ seq: m.seq, ok: m.ok });
        break;
      case 'disasters':
        this.disasters = m.list;
        break;
      case 'airports':
        this.airports = m.airports;
        break;
      case 'santa':
        this.santa.push({ trees: m.trees, now: m.now });
        break;
      case 'leaderboard':
        this.leaderboard = m;
        break;
      case 'worldStats':
        this.worldStats = m.stats;
        break;
      case 'time':
        this.time = m;
        break;
      case 'tiles':
        for (let k = 0; k < m.u.length; k += 3) {
          const x = m.u[k],
            y = m.u[k + 1];
          const c = chunkOf(x, y);
          const tiles = this.chunks.get(chunkKey(c.cx, c.cy));
          if (tiles) tiles[(y - c.cy * CHUNK) * CHUNK + (x - c.cx * CHUNK)] = m.u[k + 2];
        }
        this.tileUpdates += m.u.length / 3;
        break;
      default:
        break;
    }
  }

  send(m: ClientMsg): void {
    this.ws.send(JSON.stringify(m));
  }
  /** A message outside the protocol (the dev hooks: devFunds, devPeak, devPlace, ...). */
  sendRaw(m: object): void {
    this.ws.send(JSON.stringify(m));
  }

  close(): Promise<void> {
    if (this.ws.readyState === WebSocket.CLOSED) {
      open.delete(this);
      return Promise.resolve();
    }
    return new Promise((res) => {
      this.ws.once('close', () => res());
      this.ws.close();
    });
  }

  /** The tile at (x, y), if this client has its chunk. */
  tile(x: number, y: number): number | undefined {
    const c = chunkOf(x, y);
    return this.chunks.get(chunkKey(c.cx, c.cy))?.[(y - c.cy * CHUNK) * CHUNK + (x - c.cx * CHUNK)];
  }
  /** The tile kind (value & LOMASK) at (x, y); throws if the chunk isn't loaded. */
  kind(x: number, y: number): number {
    const v = this.tile(x, y);
    if (v === undefined) throw new Error(`${this.name} has no chunk for ${x},${y}`);
    return v & LOMASK;
  }

  /** Nearest chunk a new city could be founded on (the server's findFree), or null. */
  async findFree(cx: number, cy: number): Promise<{ cx: number; cy: number } | null> {
    this.freeSpot = null;
    this.send({ t: 'findFree', cx, cy });
    const s = await waitFor(() => this.freeSpot, 'freeSpot');
    return s.cx === null || s.cy === null ? null : { cx: s.cx, cy: s.cy };
  }

  /** Subscribe to exactly these chunks and wait for their frames (a chunk already held is not sent again). */
  async subscribe(chunks: [number, number][]): Promise<void> {
    const want = new Set(chunks.map(([cx, cy]) => chunkKey(cx, cy)));
    for (const k of [...this.chunks.keys()]) if (!want.has(k)) this.chunks.delete(k);
    this.send({ t: 'sub', chunks });
    await waitFor(() => chunks.every(([cx, cy]) => this.chunks.has(chunkKey(cx, cy))), 'chunk frames');
  }
  /** One chunk's tiles (row-major CHUNK x CHUNK); subscribe first. */
  chunk(cx: number, cy: number): Uint32Array {
    const t = this.chunks.get(chunkKey(cx, cy));
    if (!t) throw new Error(`${this.name} has no chunk ${cx},${cy}`);
    return t;
  }

  /** Claim and wait for the outcome: true on the 'claim' broadcast, false on an error toast. */
  async tryClaim(cx: number, cy: number): Promise<boolean> {
    const n = this.toasts.length;
    this.send({ t: 'claim', cx, cy });
    const r = await waitFor(() => {
      const c = this.claims.get(chunkKey(cx, cy));
      if (c && c.ownerId === this.id) return 'ok';
      for (let k = n; k < this.toasts.length; k++) if (this.toasts[k].kind === 'error') return 'err';
      return null;
    }, `claim ${cx},${cy} outcome`);
    return r === 'ok';
  }
  /** Claim; throws with the error toast if refused. */
  async claim(cx: number, cy: number): Promise<void> {
    const n = this.toasts.length;
    if (!(await this.tryClaim(cx, cy))) throw new Error(`${this.name} could not claim ${cx},${cy}: ${this.toastText(n)}`);
  }

  myClaims(): ClaimInfo[] {
    return [...this.claims.values()].filter((c) => c.ownerId === this.id);
  }

  /** Build and wait for the server's 'built' ack (it comes after the tiles that carry the change). Returns
   *  whether it was applied and the toasts it brought. */
  async build(tool: ToolId, x: number, y: number): Promise<{ ok: boolean; toasts: Toast[] }> {
    const seq = ++this.seq;
    const n = this.toasts.length;
    this.send({ t: 'build', tool, x, y, seq });
    // the build's toasts and stats come before its ack
    const a = await waitFor(() => this.built.find((b) => b.seq === seq), `built ack for ${tool} at ${x},${y}`);
    return { ok: a.ok, toasts: this.toasts.slice(n) };
  }
  private seq = 0;

  /** Query a tile (the info panel) and wait for the answer. */
  async query(x: number, y: number): Promise<QueryInfo> {
    const n = this.queries.length;
    this.send({ t: 'query', x, y });
    return waitFor(() => this.queries[n], `query ${x},${y}`);
  }

  /** "kind: msg" of every toast since index n, joined (for failure messages). */
  toastText(n = 0): string {
    return this.toasts
      .slice(n)
      .map((t) => `${t.kind}: ${t.msg}`)
      .join(' | ');
  }
  hasToast(re: RegExp, since = 0): boolean {
    return this.toasts.slice(since).some((t) => re.test(`${t.kind}: ${t.msg}`));
  }
  /** Wait for a toast matching re ("kind: msg") after index n. */
  async toastAfter(n: number, re: RegExp, ms = 3000): Promise<Toast> {
    return waitFor(() => this.toasts.slice(n).find((t) => re.test(`${t.kind}: ${t.msg}`)), `toast ${re} for ${this.name} (got: ${this.toastText(n)})`, ms);
  }
}

/** Land at every tile of the w x h rectangle at offset (ox, oy) of a chunk's tiles? */
export function dryRect(tiles: Uint32Array, ox: number, oy: number, w: number, h: number): boolean {
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) if (isWater(tiles[(oy + dy) * CHUNK + ox + dx])) return false;
  return true;
}

/**
 * Settle on a free dry site: for each candidate chunk, the nearest free one (findFree); subscribe, and look for a
 * w x h land rectangle at offsets x0..x1, y0..y1 (inclusive starts, scanned row by row); claim the first chunk
 * that has one. Returns its chunk and the rectangle's world position.
 */
export async function settle(
  c: TestClient,
  candidates: [number, number][],
  w: number,
  h: number,
  scan: { x0?: number; x1?: number; y0?: number; y1?: number; claim?: boolean } = {},
): Promise<{ cx: number; cy: number; x: number; y: number }> {
  const { x0 = 1, y0 = 1, x1 = CHUNK - 1 - w, y1 = CHUNK - 1 - h, claim = true } = scan;
  for (const [ccx, ccy] of candidates) {
    const spot = await c.findFree(ccx, ccy);
    if (!spot) continue;
    await c.subscribe([[spot.cx, spot.cy]]);
    const tiles = c.chunk(spot.cx, spot.cy);
    for (let oy = y0; oy <= y1; oy++)
      for (let ox = x0; ox <= x1; ox++)
        if (dryRect(tiles, ox, oy, w, h)) {
          if (claim) await c.claim(spot.cx, spot.cy);
          return { cx: spot.cx, cy: spot.cy, x: spot.cx * CHUNK + ox, y: spot.cy * CHUNK + oy };
        }
  }
  throw new Error(`no free chunk with a dry ${w}x${h} site near ${JSON.stringify(candidates)}`);
}
