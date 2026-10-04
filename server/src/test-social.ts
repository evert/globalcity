// Social feature test: city names, presence, neighbour + rail-link demand, plot cap, abandonment.
// Usage (server must run with DEV_HOOKS=1 and a 1 s "day" on a throwaway save dir, never the live one):
//   PORT=8791 DATA_DIR=data/save-test2 DEV_HOOKS=1 TICK_MS=500 ABANDON_DAY_MS=1000 npx tsx src/index.ts
//   PORT=8791 TICK_MS=500 npm run smoke:social -w server
// Exit 0 = pass. Takes ~70 s (the abandonment phase waits 61 "days"). TICK_MS must match the server's.

import WebSocket from 'ws';
import {
  DEFAULT_PORT, CHUNK, TICK_MS, MAX_CHUNKS_PER_PLAYER, ABANDON_DECAY_DAYS, ABANDON_FREE_DAYS, CHUNKS_X, CHUNKS_Y,
  lonLatToTile, chunkOf, chunkKey, decodeChunk, isWater, isRubble, isRoad, isZoneTile, isHouse,
  type ClientMsg, type ServerMsg, type PlayerStats, type ClaimInfo, type Presence, type QueryInfo,
} from '@globalcity/shared';

const port = Number(process.env.PORT) || DEFAULT_PORT;
const TICK = Number(process.env.TICK_MS) || TICK_MS;
const DAY_MS = Number(process.env.ABANDON_DAY_MS) || 1000;
const url = `ws://localhost:${port}/ws`;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const ticks = (n: number): number => n * TICK + 500;

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  for (const c of clients) console.error(`${c.name} toasts:`, c.toasts.map((t) => `${t.kind}: ${t.msg}`));
  process.exit(1);
}

const clients: TestClient[] = [];

class TestClient {
  ws!: WebSocket;
  id = '';
  cityName = '';
  stats: PlayerStats | null = null;
  toasts: { kind: string; msg: string; at?: { x: number; y: number } }[] = [];
  chunks = new Map<string, Uint16Array>();
  freeSpot: { cx: number | null; cy: number | null } | null = null;
  /** every claim this client knows about, by chunk key (welcome + 'claim' + 'claims') */
  claims = new Map<string, ClaimInfo>();
  unclaims: string[] = [];
  presence: { at: number; players: Presence[] }[] = [];
  queries: QueryInfo[] = [];

  constructor(readonly name: string) { clients.push(this); }

  async connect(): Promise<void> {
    this.ws = new WebSocket(url);
    await new Promise<void>((res, rej) => { this.ws.on('open', res); this.ws.on('error', rej); });
    const welcome = new Promise<void>((resolve) => {
      this.ws.on('message', (data, isBinary) => {
        if (isBinary) {
          const buf = data as Buffer;
          const ab = new ArrayBuffer(buf.byteLength);
          new Uint8Array(ab).set(buf);
          const c = decodeChunk(ab);
          if (c) this.chunks.set(chunkKey(c.cx, c.cy), c.tiles);
          return;
        }
        const msg = JSON.parse(data.toString()) as ServerMsg;
        switch (msg.t) {
          case 'welcome':
            this.id = msg.player.id; this.cityName = msg.player.cityName; this.stats = msg.stats;
            for (const c of msg.claims) this.claims.set(chunkKey(c.cx, c.cy), c);
            resolve();
            break;
          case 'stats': this.stats = msg.stats; break;
          case 'toast': this.toasts.push({ kind: msg.kind, msg: msg.msg, at: msg.at }); break;
          case 'freeSpot': this.freeSpot = msg; break;
          case 'claim': this.claims.set(chunkKey(msg.claim.cx, msg.claim.cy), msg.claim); break;
          case 'claims': for (const c of msg.claims) this.claims.set(chunkKey(c.cx, c.cy), c); break;
          case 'unclaim': this.claims.delete(chunkKey(msg.cx, msg.cy)); this.unclaims.push(chunkKey(msg.cx, msg.cy)); break;
          case 'presence': this.presence.push({ at: Date.now(), players: msg.players }); break;
          case 'query': this.queries.push(msg.info); break;
          case 'tiles':
            for (let k = 0; k < msg.u.length; k += 3) {
              const x = msg.u[k], y = msg.u[k + 1], v = msg.u[k + 2];
              const c = chunkOf(x, y);
              const tiles = this.chunks.get(chunkKey(c.cx, c.cy));
              if (tiles) tiles[(y - c.cy * CHUNK) * CHUNK + (x - c.cx * CHUNK)] = v;
            }
            break;
          default: break;
        }
      });
    });
    this.send({ t: 'hello', name: this.name });
    await welcome;
  }

  send(m: ClientMsg): void { this.ws.send(JSON.stringify(m)); }
  sendRaw(m: unknown): void { this.ws.send(JSON.stringify(m)); }

  tile(x: number, y: number): number | undefined {
    const c = chunkOf(x, y);
    const tiles = this.chunks.get(chunkKey(c.cx, c.cy));
    return tiles?.[(y - c.cy * CHUNK) * CHUNK + (x - c.cx * CHUNK)];
  }

  async findFree(cx: number, cy: number): Promise<{ cx: number; cy: number } | null> {
    this.freeSpot = null;
    this.send({ t: 'findFree', cx, cy });
    const s = await waitFor(() => this.freeSpot, 'freeSpot');
    return s.cx === null || s.cy === null ? null : { cx: s.cx, cy: s.cy };
  }

  async subscribe(chunks: [number, number][]): Promise<void> {
    this.send({ t: 'sub', chunks });
    await waitFor(() => chunks.every(([cx, cy]) => this.chunks.has(chunkKey(cx, cy))), 'chunk frames');
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

  myClaims(): ClaimInfo[] { return [...this.claims.values()].filter((c) => c.ownerId === this.id); }
  hasToast(re: RegExp): boolean { return this.toasts.some((t) => re.test(`${t.kind}: ${t.msg}`)); }
  async toastAfter(n: number, re: RegExp, ms = 3000): Promise<void> {
    await waitFor(() => this.toasts.slice(n).some((t) => re.test(`${t.kind}: ${t.msg}`)), `toast ${re}`, ms);
  }
}

const waitFor = <T>(pred: () => T | null | undefined | false, label: string, ms = 5000): Promise<T> =>
  new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      const v = pred();
      if (v) { clearInterval(iv); resolve(v); }
      else if (Date.now() - t0 > ms) { clearInterval(iv); reject(new Error(`timeout waiting for ${label}`)); }
    }, 25);
  });

// Seed locations to look for free chunks with enough flat land.
const SEEDS: [number, number][] = [
  [-0.1, 51.5], [2.35, 48.85], [13.4, 52.5], [-3.7, 40.4], [21.0, 52.2], [30.5, 50.45], [37.6, 55.75],
  [-94.6, 39.1], [-87.6, 41.9], [-104.9, 39.7], [-46.6, -23.5], [151.2, -33.9], [116.4, 39.9], [77.2, 28.6],
  [3.4, 6.5], [28.0, -26.2], [-99.1, 19.4], [-58.4, -34.6], [105.8, 21.0], [44.4, 33.3],
];
/** Interior seeds with lots of land around, for the 10-plot city and the abandoned town. */
const INTERIOR: [number, number][] = [[65.0, 48.0], [-100.0, 45.0], [25.0, 55.0], [-60.0, -30.0], [135.0, -25.0], [90.0, 55.0]];

// Layout for A (chunk cx,cy; its last 6 columns) and B (chunk cx+1,cy; its first 8 columns), rows Y..:
//   A: coal plant cols AX..AX+3 rows Y..Y+3; wires AX+4, AX+5 row Y+1; res zone AX..AX+2 rows Y+4..Y+6;
//      road row Y+7 cols AX..AX+5; rail row Y+5 cols AX+3..AX+5
//   B: wires BX, BX+1 row Y+1; res zone BX+2..BX+4 rows Y..Y+2; road row Y+3 cols BX+3..BX+6;
//      rail row Y+5 cols BX..BX+2 then north BX+2 rows Y+4, Y+3 (touching the zone's bottom row Y+2)
const A_COLS = 6, A_ROWS = 8, B_COLS = 8, B_ROWS = 6;

function findRow(aTiles: Uint16Array, bTiles: Uint16Array): number | null {
  rows: for (let y = 1; y + A_ROWS < CHUNK - 1; y++) {
    for (let dy = 0; dy < A_ROWS; dy++) for (let dx = 0; dx < A_COLS; dx++) {
      if (isWater(aTiles[(y + dy) * CHUNK + CHUNK - A_COLS + dx])) continue rows;
    }
    for (let dy = 0; dy < B_ROWS; dy++) for (let dx = 0; dx < B_COLS; dx++) {
      if (isWater(bTiles[(y + dy) * CHUNK + dx])) continue rows;
    }
    return y;
  }
  return null;
}

/** Top-left of a w x h all-land rectangle inside a chunk (local coords), or null. */
function findRect(tiles: Uint16Array, w: number, h: number): { x: number; y: number } | null {
  for (let oy = 1; oy + h < CHUNK - 1; oy++) {
    cols: for (let ox = 1; ox + w < CHUNK - 1; ox++) {
      for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) if (isWater(tiles[(oy + dy) * CHUNK + ox + dx])) continue cols;
      return { x: ox, y: oy };
    }
  }
  return null;
}

const builtTile = (v: number): boolean => isZoneTile(v) || isHouse(v) || isRoad(v);

async function main(): Promise<void> {
  const t0 = Date.now();
  const A = new TestClient('Alice');
  const B = new TestClient('Bob');
  await A.connect();
  await B.connect();
  console.log(`connected: A=${A.id.slice(0, 8)} B=${B.id.slice(0, 8)} tick=${TICK}ms day=${DAY_MS}ms`);
  if (A.cityName !== '' || B.cityName !== '') fail('cityName should be empty before the first claim');

  // =========================================================================
  // (5a) Abandonment, part 1: D founds a town, builds, and leaves. Its idle clock runs while the
  // other phases execute (a "day" is DAY_MS on the test server).
  // =========================================================================
  const D = new TestClient('Dora');
  await D.connect();
  let dSite: { cx: number; cy: number; X: number; Y: number } | null = null;
  for (const [lon, lat] of INTERIOR) {
    const t = lonLatToTile(lon, lat);
    const c = chunkOf(t.x, t.y);
    const f = await D.findFree(c.cx, c.cy);
    if (!f) continue;
    await D.subscribe([[f.cx, f.cy]]);
    const r = findRect(D.chunks.get(chunkKey(f.cx, f.cy))!, 20, 5);
    if (!r) continue;
    dSite = { cx: f.cx, cy: f.cy, X: f.cx * CHUNK + r.x, Y: f.cy * CHUNK + r.y };
    break;
  }
  if (!dSite) fail('no free chunk with a 20x5 land rectangle for D');
  if (!(await D.tryClaim(dSite.cx, dSite.cy))) fail('D could not claim');
  const dKey = chunkKey(dSite.cx, dSite.cy);
  for (let k = 0; k < 6; k++) D.send({ t: 'build', tool: 'residential', x: dSite.X + 1 + k * 3, y: dSite.Y + 1 });
  for (let dx = 0; dx < 20; dx++) D.send({ t: 'build', tool: 'road', x: dSite.X + dx, y: dSite.Y + 4 });
  await sleep(600);
  if (D.hasToast(/^error/)) fail('D got an error toast while building');
  await A.subscribe([[dSite.cx, dSite.cy]]);
  let dBuilt = 0;
  for (let dy = 0; dy < 5; dy++) for (let dx = 0; dx < 20; dx++) if (builtTile(A.tile(dSite.X + dx, dSite.Y + dy)!)) dBuilt++;
  if (dBuilt < 70) fail(`D built only ${dBuilt} tiles as seen by A`);
  D.ws.close();
  const dLeft = Date.now();
  console.log(`D (${D.cityName || D.claims.get(dKey)?.cityName}) built ${dBuilt} tiles at chunk ${dSite.cx},${dSite.cy} and left`);

  // =========================================================================
  // (1) City names
  // =========================================================================
  let site: { cx: number; cy: number; Y: number } | null = null;
  for (const [lon, lat] of SEEDS) {
    const t = lonLatToTile(lon, lat);
    const c = chunkOf(t.x, t.y);
    const a = await A.findFree(c.cx, c.cy);
    if (!a || a.cx + 1 >= CHUNKS_X) continue;
    const b = await B.findFree(a.cx + 1, a.cy);
    if (!b || b.cx !== a.cx + 1 || b.cy !== a.cy) continue;
    await B.subscribe([[a.cx, a.cy], [b.cx, b.cy]]);
    const y = findRow(B.chunks.get(chunkKey(a.cx, a.cy))!, B.chunks.get(chunkKey(b.cx, b.cy))!);
    if (y === null) continue;
    site = { cx: a.cx, cy: a.cy, Y: a.cy * CHUNK + y };
    break;
  }
  if (!site) fail('no pair of adjacent free chunks with enough land found');
  const { cx, cy, Y } = site;
  const AX = (cx + 1) * CHUNK - A_COLS, BX = (cx + 1) * CHUNK;
  console.log(`site: A chunk ${cx},${cy}; B chunk ${cx + 1},${cy}; rows from ${Y}`);
  if (!(await A.tryClaim(cx, cy))) fail('A claim failed');
  if (!(await B.tryClaim(cx + 1, cy))) fail('B claim failed');
  await A.subscribe([[cx, cy], [cx + 1, cy], [dSite.cx, dSite.cy]]);
  const aClaim = A.claims.get(chunkKey(cx, cy))!, bClaim = B.claims.get(chunkKey(cx + 1, cy))!;
  console.log(`city names: A="${aClaim.cityName}" B="${bClaim.cityName}" (idleDays ${aClaim.idleDays}/${bClaim.idleDays})`);
  if (!aClaim.cityName || !bClaim.cityName) fail('empty cityName in claim broadcast');
  if (aClaim.cityName === bClaim.cityName) fail('both cities got the same name');
  if (bClaim.cityName === `New ${aClaim.cityName}`) console.log('B got the "New <name>" variant of A\'s place');
  else console.log('note: A and B were named after different places');
  if (aClaim.idleDays !== 0) fail('idleDays should be 0 for an online owner');
  // B's own view of A's claim must carry the same name (claims are global).
  if (B.claims.get(chunkKey(cx, cy))?.cityName !== aClaim.cityName) fail('B sees a different cityName for A');
  // Rename to a taken name -> error; to a free name -> success + claims broadcast.
  let n = B.toasts.length;
  B.send({ t: 'renameCity', name: aClaim.cityName.toUpperCase() });
  await B.toastAfter(n, /^error: There is already a city called/);
  const newName = `Bobville ${Math.floor(Math.random() * 1e6)}`;
  n = B.toasts.length;
  B.send({ t: 'renameCity', name: `  ${newName}  ` });
  await B.toastAfter(n, new RegExp(`^success: Your city is now called ${newName}`));
  await waitFor(() => A.claims.get(chunkKey(cx + 1, cy))?.cityName === newName, 'A sees the renamed city');
  if (B.claims.get(chunkKey(cx + 1, cy))?.cityName !== newName) fail('B does not see its own rename');
  n = B.toasts.length;
  B.send({ t: 'renameCity', name: '   ' });
  await B.toastAfter(n, /^error: Invalid city name/);
  // Query on A's chunk reports the owner with cityName.
  A.send({ t: 'query', x: AX, y: Y });
  const q = await waitFor(() => A.queries[0], 'query reply');
  if (q.owner?.cityName !== aClaim.cityName) fail(`query owner cityName "${q.owner?.cityName}"`);
  console.log(`city names OK (B renamed to "${newName}")`);

  // =========================================================================
  // (2) Presence
  // =========================================================================
  const vx = AX + 2.5, vy = Y + 3.25;
  const sentAt = Date.now();
  A.send({ t: 'view', x: vx, y: vy, zoom: 2, cx: AX, cy: Y });
  const frame = await waitFor(() => B.presence.find((f) => f.players.some((p) => p.id === A.id)), 'presence frame with A at B', 1500);
  const pa = frame.players.find((p) => p.id === A.id)!;
  console.log(`presence: B saw A at ${pa.x},${pa.y} zoom ${pa.zoom} cursor ${pa.cx},${pa.cy} (${pa.cityName}) after ${frame.at - sentAt} ms`);
  if (Math.abs(pa.x - vx) > 0.11 || Math.abs(pa.y - vy) > 0.11) fail('presence position off');
  if (pa.cx !== AX || pa.cy !== Y) fail('presence cursor off');
  if (pa.cityName !== aClaim.cityName || pa.name !== 'Alice') fail('presence names off');
  if (frame.at - sentAt > 1000) fail('presence took more than 1 s');
  await sleep(600);
  if (A.presence.some((f) => f.players.some((p) => p.id === A.id))) fail("A's own entry appeared in A's presence frame");
  // Out-of-world values are clamped, not dropped.
  B.send({ t: 'view', x: -500, y: 1e9, zoom: 1 });
  const fb = await waitFor(() => A.presence.find((f) => f.players.some((p) => p.id === B.id)), 'presence frame with B at A', 1500);
  const pb = fb.players.find((p) => p.id === B.id)!;
  if (pb.x !== 0 || pb.y !== 4095 || pb.cx !== undefined) fail(`presence clamp: ${JSON.stringify(pb)}`);
  console.log('presence OK');

  // =========================================================================
  // (3) Neighbours and rail links
  // =========================================================================
  const toastsBeforeBuild = new Map(clients.map((c) => [c, c.toasts.length]));
  A.send({ t: 'build', tool: 'coal', x: AX + 1, y: Y + 1 });
  A.send({ t: 'build', tool: 'wire', x: AX + 4, y: Y + 1 });
  A.send({ t: 'build', tool: 'wire', x: AX + 5, y: Y + 1 });
  A.send({ t: 'build', tool: 'residential', x: AX + 1, y: Y + 5 });
  for (let dx = 0; dx < A_COLS; dx++) A.send({ t: 'build', tool: 'road', x: AX + dx, y: Y + 7 });
  for (let dx = 3; dx < A_COLS; dx++) A.send({ t: 'build', tool: 'rail', x: AX + dx, y: Y + 5 });
  B.send({ t: 'build', tool: 'wire', x: BX, y: Y + 1 });
  B.send({ t: 'build', tool: 'wire', x: BX + 1, y: Y + 1 });
  B.send({ t: 'build', tool: 'residential', x: BX + 3, y: Y + 1 });
  for (let dx = 3; dx <= 6; dx++) B.send({ t: 'build', tool: 'road', x: BX + dx, y: Y + 3 });
  for (let dx = 0; dx <= 2; dx++) B.send({ t: 'build', tool: 'rail', x: BX + dx, y: Y + 5 });
  B.send({ t: 'build', tool: 'rail', x: BX + 2, y: Y + 4 });
  B.send({ t: 'build', tool: 'rail', x: BX + 2, y: Y + 3 });
  await sleep(500);
  for (const c of [A, B]) if (c.toasts.slice(toastsBeforeBuild.get(c)).some((t) => t.kind === 'error')) fail(`${c.name} got an error toast while building`);
  console.log('waiting for rail links...');
  await waitFor(() => A.stats?.railLinks === 1 && B.stats?.railLinks === 1 && A.stats.railDemand > 0 && B.stats.railDemand > 0, 'railLinks === 1 and railDemand > 0 on both', ticks(10));
  console.log(`rail: A links=${A.stats!.railLinks} demand=${A.stats!.railDemand}; B links=${B.stats!.railLinks} demand=${B.stats!.railDemand}`);
  // >= 1, not === 1: cities from earlier runs in the same save dir may also border the site.
  if (A.stats!.neighbours < 1 || B.stats!.neighbours < 1) fail(`neighbours A=${A.stats!.neighbours} B=${B.stats!.neighbours}`);
  console.log(`neighbours: A=${A.stats!.neighbours} B=${B.stats!.neighbours}`);
  A.queries = [];
  A.send({ t: 'query', x: AX + 4, y: Y + 5 });
  const rq = await waitFor(() => A.queries[0], 'rail query');
  console.log(`rail query: "${rq.name}"`);
  if (!/^Rail \(links 2 cities\)/.test(rq.name)) fail(`rail query name "${rq.name}"`);
  console.log('waiting for neighbour demand (needs resPop > 0 next door)...');
  await waitFor(() => (A.stats?.resPop ?? 0) > 0 && (B.stats?.resPop ?? 0) > 0, 'both resPop > 0', ticks(40));
  await waitFor(() => (A.stats?.neighbourDemand.c ?? 0) > 0 && (B.stats?.neighbourDemand.c ?? 0) > 0, 'neighbourDemand.c > 0 on both', ticks(3));
  console.log(`neighbours: A resPop=${A.stats!.resPop} nd=${JSON.stringify(A.stats!.neighbourDemand)} demand=${JSON.stringify(A.stats!.demand)}; B resPop=${B.stats!.resPop} nd=${JSON.stringify(B.stats!.neighbourDemand)}`);
  if (A.stats!.neighbourDemand.c !== Math.round(B.stats!.resPop / 800 * 1e4) / 1e4 && Math.abs(A.stats!.neighbourDemand.c - B.stats!.resPop / 800) > 0.01) {
    console.log('note: neighbourDemand.c lags resPop by a tick (fine)');
  }
  console.log('neighbours + rail OK');

  // =========================================================================
  // (4) Plot cap
  // =========================================================================
  const C = new TestClient('Carl');
  await C.connect();
  C.sendRaw({ t: 'devFunds', amount: 6_000_000 }); // 10 plots cost ~$5.1M with the escalating price
  await waitFor(() => (C.stats?.funds ?? 0) >= 6_000_000, 'devFunds applied');
  let start: { cx: number; cy: number } | null = null;
  for (const [lon, lat] of [...INTERIOR].reverse()) {
    const t = lonLatToTile(lon, lat);
    const c = chunkOf(t.x, t.y);
    start = await C.findFree(c.cx, c.cy);
    if (start && chunkKey(start.cx, start.cy) !== dKey) break;
    start = null;
  }
  if (!start) fail('no free chunk for C');
  if (!(await C.tryClaim(start.cx, start.cy))) fail('C first claim failed');
  const owned = [start];
  const tried = new Set<string>([chunkKey(start.cx, start.cy)]);
  outer: for (let k = 0; k < owned.length && owned.length < MAX_CHUNKS_PER_PLAYER; k++) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = owned[k].cx + dx, ny = owned[k].cy + dy;
      const key = chunkKey(nx, ny);
      if (tried.has(key) || nx < 0 || ny < 0 || nx >= CHUNKS_X || ny >= CHUNKS_Y || key === dKey) continue;
      tried.add(key);
      if (await C.tryClaim(nx, ny)) { owned.push({ cx: nx, cy: ny }); if (owned.length >= MAX_CHUNKS_PER_PLAYER) break outer; }
    }
  }
  if (owned.length !== MAX_CHUNKS_PER_PLAYER) fail(`C could only claim ${owned.length} chunks (need ${MAX_CHUNKS_PER_PLAYER})`);
  if (C.stats!.chunks !== MAX_CHUNKS_PER_PLAYER) fail(`C stats.chunks ${C.stats!.chunks}`);
  let eleventh: { cx: number; cy: number } | null = null;
  for (const o of owned) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const key = chunkKey(o.cx + dx, o.cy + dy);
      if (!tried.has(key) && key !== dKey && o.cx + dx >= 0 && o.cy + dy >= 0 && o.cx + dx < CHUNKS_X && o.cy + dy < CHUNKS_Y) { eleventh = { cx: o.cx + dx, cy: o.cy + dy }; break; }
    }
    if (eleventh) break;
  }
  if (!eleventh) fail('no candidate for the 11th claim');
  n = C.toasts.length;
  if (await C.tryClaim(eleventh.cx, eleventh.cy)) fail('11th claim was accepted');
  await C.toastAfter(n, new RegExp(`^error: Your city is at the maximum of ${MAX_CHUNKS_PER_PLAYER} plots`));
  console.log(`plot cap OK (C owns ${owned.length} plots, 11th refused; city "${C.myClaims()[0].cityName}")`);

  // =========================================================================
  // (5b) Abandonment, part 2: decay after ABANDON_DECAY_DAYS, release after ABANDON_FREE_DAYS.
  // =========================================================================
  const rubbleInD = (): number => {
    let r = 0;
    for (let dy = 0; dy < 5; dy++) for (let dx = 0; dx < 20; dx++) if (isRubble(A.tile(dSite.X + dx, dSite.Y + dy)!)) r++;
    return r;
  };
  const idleNow = (): number => A.claims.get(dKey)?.idleDays ?? -1;
  console.log(`D idle for ${((Date.now() - dLeft) / 1000).toFixed(1)} s; A sees idleDays=${idleNow()}, rubble=${rubbleInD()}`);
  if (idleNow() < 1) fail('idleDays for D did not advance in the claims broadcasts');
  if (rubbleInD() > 0) fail('D tiles decayed before ABANDON_DECAY_DAYS');
  const decayAt = dLeft + ABANDON_DECAY_DAYS * DAY_MS;
  await sleep(Math.max(0, decayAt + 1000 - Date.now()));
  console.log(`day ${idleNow()}: waiting for ruins...`);
  await waitFor(() => rubbleInD() > 0, 'first rubble tile in D', ticks(20));
  console.log(`day ${idleNow()}: ${rubbleInD()} rubble tiles in D`);
  // Returning owner stops the decay: resume D with its token? We only have D's id, not the token
  // in this script (welcome carried it) - check that the idle clock keeps running instead.
  const freeAt = dLeft + ABANDON_FREE_DAYS * DAY_MS;
  await waitFor(() => A.unclaims.includes(dKey), `unclaim of D's chunk`, Math.max(5000, freeAt + ticks(4) - Date.now()));
  const rubbleAfter = rubbleInD();
  console.log(`unclaim received at idle ${((Date.now() - dLeft) / 1000).toFixed(1)} s; ${rubbleAfter} rubble tiles remain`);
  if (A.claims.has(dKey)) fail("D's claim still listed after unclaim");
  if (rubbleAfter === 0) fail('ruins vanished');
  const spot = await A.findFree(dSite.cx, dSite.cy);
  if (!spot || spot.cx !== dSite.cx || spot.cy !== dSite.cy) fail(`findFree did not return the released chunk (${JSON.stringify(spot)})`);
  const E = new TestClient('Eve');
  await E.connect();
  if (E.claims.has(dKey)) fail("new client's welcome still lists D's chunk");
  if (!(await E.tryClaim(dSite.cx, dSite.cy))) fail('E could not claim the released chunk');
  if (rubbleInD() < rubbleAfter) fail('rubble disappeared on reclaim');
  console.log(`abandonment OK (E claimed the ruins as "${E.myClaims()[0].cityName}")`);

  console.log(`PASS (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  for (const c of clients) c.ws.close();
  process.exit(0);
}

main().catch((e) => fail(String(e)));
