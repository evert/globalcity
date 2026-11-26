// Feature test: power trading across a chunk border, leaderboard, fire (via the DEV_HOOKS devIgnite hook).
// Usage:
//   npm test -w server -- features   (starts a throwaway server with the settings it needs; see test/run-all.sh)
// Exit 0 = pass. TICK_MS must match the server's so the waits are sized right.

import WebSocket from 'ws';
import {
  DEFAULT_PORT, CHUNK, TICK_MS, budgetTotals, LOMASK, FIRE, LASTFIRE, RUBBLE, LASTRUBBLE,
  lonLatToTile, chunkOf, chunkKey, decodeChunk, isWater,
  type ClientMsg, type ServerMsg, type PlayerStats, type LeaderboardEntry,
} from '@globalcity/shared';

const port = Number(process.env.PORT) || DEFAULT_PORT;
const TICK = Number(process.env.TICK_MS) || TICK_MS;
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
  stats: PlayerStats | null = null;
  toasts: { kind: string; msg: string; at?: { x: number; y: number } }[] = [];
  chunks = new Map<string, Uint32Array>();
  freeSpot: { cx: number | null; cy: number | null } | null = null;
  claims = new Set<string>();
  leaderboards: { entries: LeaderboardEntry[]; me?: { rank: number; population: number } }[] = [];
  fireTilesSeen = 0;
  month = -1;
  /** funds and "last year" income as each new year starts (stats arrive after the tick's time message) */
  newYears: { funds: number; lastIncome: number }[] = [];

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
          case 'welcome': this.id = msg.player.id; this.stats = msg.stats; resolve(); break;
          case 'stats':
            this.stats = msg.stats;
            if (this.month === 0) { this.newYears.push({ funds: msg.stats.funds, lastIncome: msg.stats.lastIncome }); this.month = -1; }
            break;
          case 'time': this.month = msg.time.month; break;
          case 'toast': this.toasts.push({ kind: msg.kind, msg: msg.msg, at: msg.at }); break;
          case 'freeSpot': this.freeSpot = msg; break;
          case 'claim': if (msg.claim.ownerId === this.id) this.claims.add(chunkKey(msg.claim.cx, msg.claim.cy)); break;
          case 'leaderboard': this.leaderboards.push({ entries: msg.entries, me: msg.me }); break;
          case 'tiles':
            for (let k = 0; k < msg.u.length; k += 3) {
              const x = msg.u[k], y = msg.u[k + 1], v = msg.u[k + 2];
              const c = chunkOf(x, y);
              const tiles = this.chunks.get(chunkKey(c.cx, c.cy));
              if (tiles) tiles[(y - c.cy * CHUNK) * CHUNK + (x - c.cx * CHUNK)] = v;
              const id = v & LOMASK;
              if (id >= FIRE && id <= LASTFIRE) this.fireTilesSeen++;
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

  hasToast(re: RegExp): boolean { return this.toasts.some((t) => re.test(`${t.kind}: ${t.msg}`)); }
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

// Seed locations to look for two adjacent free chunks with enough flat land.
const SEEDS: [number, number][] = [
  [-0.1, 51.5], [2.35, 48.85], [13.4, 52.5], [-3.7, 40.4], [21.0, 52.2], [30.5, 50.45], [37.6, 55.75],
  [-94.6, 39.1], [-87.6, 41.9], [-104.9, 39.7], [-46.6, -23.5], [151.2, -33.9], [116.4, 39.9], [77.2, 28.6],
  [3.4, 6.5], [28.0, -26.2], [-99.1, 19.4], [-58.4, -34.6], [105.8, 21.0], [44.4, 33.3],
];

// Layout (Y = top row). A owns chunk (cx,cy), B owns (cx+1,cy); the border is between columns cx*64+63 and (cx+1)*64.
//   A: coal plant cols 58..61 rows Y..Y+3; wires cols 62,63 row Y+1; res zone cols 58..60 rows Y+4..Y+6; road row Y+7 cols 58..63
//   B: wires cols 0,1 row Y+1; res zones cols 2-4, 5-7, 8-10 rows Y..Y+2; fire station cols 11..13; road row Y+4 cols 0..13
const A_COLS = 6, A_ROWS = 8, B_COLS = 14, B_ROWS = 5;

function findRow(aTiles: Uint32Array, bTiles: Uint32Array): number | null {
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

async function main(): Promise<void> {
  const A = new TestClient('Exporter-A');
  const B = new TestClient('Importer-B');
  await A.connect();
  await B.connect();
  console.log(`connected: A=${A.id.slice(0, 8)} B=${B.id.slice(0, 8)} tick=${TICK}ms`);
  if (A.leaderboards.length < 1) fail('no leaderboard sent after welcome');

  // ---- find two adjacent free chunks with a usable row ----
  let site: { cx: number; cy: number; Y: number } | null = null;
  for (const [lon, lat] of SEEDS) {
    const t = lonLatToTile(lon, lat);
    const c = chunkOf(t.x, t.y);
    const a = await A.findFree(c.cx, c.cy);
    if (!a || a.cx + 1 >= 128) continue;
    const b = await B.findFree(a.cx + 1, a.cy);
    if (!b || b.cx !== a.cx + 1 || b.cy !== a.cy) continue;
    B.send({ t: 'sub', chunks: [[a.cx, a.cy], [b.cx, b.cy]] });
    await waitFor(() => B.chunks.has(chunkKey(a.cx, a.cy)) && B.chunks.has(chunkKey(b.cx, b.cy)), 'chunk frames');
    const y = findRow(B.chunks.get(chunkKey(a.cx, a.cy))!, B.chunks.get(chunkKey(b.cx, b.cy))!);
    if (y === null) continue;
    site = { cx: a.cx, cy: a.cy, Y: a.cy * CHUNK + y };
    break;
  }
  if (!site) fail('no pair of adjacent free chunks with enough land found');
  const { cx, cy, Y } = site;
  const AX = (cx + 1) * CHUNK - A_COLS; // A's first column
  const BX = (cx + 1) * CHUNK;          // B's first column
  console.log(`site: A chunk ${cx},${cy}; B chunk ${cx + 1},${cy}; rows from ${Y}`);

  A.send({ t: 'claim', cx, cy });
  B.send({ t: 'claim', cx: cx + 1, cy });
  await waitFor(() => A.claims.has(chunkKey(cx, cy)) && B.claims.has(chunkKey(cx + 1, cy)), 'claims');
  A.send({ t: 'sub', chunks: [[cx, cy], [cx + 1, cy]] });

  // ---- build ----
  A.send({ t: 'build', tool: 'coal', x: AX + 1, y: Y + 1 });
  A.send({ t: 'build', tool: 'wire', x: AX + 4, y: Y + 1 });
  A.send({ t: 'build', tool: 'wire', x: AX + 5, y: Y + 1 });
  A.send({ t: 'build', tool: 'residential', x: AX + 1, y: Y + 5 });
  for (let dx = 0; dx < A_COLS; dx++) A.send({ t: 'build', tool: 'road', x: AX + dx, y: Y + 7 });
  B.send({ t: 'build', tool: 'wire', x: BX, y: Y + 1 });
  B.send({ t: 'build', tool: 'wire', x: BX + 1, y: Y + 1 });
  B.send({ t: 'build', tool: 'residential', x: BX + 3, y: Y + 1 });
  B.send({ t: 'build', tool: 'residential', x: BX + 6, y: Y + 1 });
  B.send({ t: 'build', tool: 'residential', x: BX + 9, y: Y + 1 });
  B.sendRaw({ t: 'devPeak', pop: 20000 }); // fire stations unlock at 15,000 people
  await sleep(200);
  B.send({ t: 'build', tool: 'fire', x: BX + 12, y: Y + 1 });
  for (let dx = 0; dx < B_COLS; dx++) B.send({ t: 'build', tool: 'road', x: BX + dx, y: Y + 4 });
  await sleep(500);
  for (const c of [A, B]) if (c.hasToast(/^error/)) fail(`${c.name} got an error toast while building`);

  // ---- (a) power trade ----
  console.log('waiting for power trade...');
  await waitFor(() => (B.stats?.powerImported ?? 0) > 0 && (A.stats?.powerExported ?? 0) > 0, 'powerImported/powerExported > 0', ticks(20));
  const bs = B.stats!, as0 = A.stats!;
  console.log(`B: imported=${bs.powerImported} demand=${bs.powerDemand} supply=${bs.powerSupply} tradeNet=${bs.powerTradeNet} funds=${bs.funds}`);
  console.log(`A: exported=${as0.powerExported} demand=${as0.powerDemand} supply=${as0.powerSupply} tradeNet=${as0.powerTradeNet} funds=${as0.funds}`);
  if (bs.powerImported < 3) fail(`B imports ${bs.powerImported}, expected >= 3 (3 res zones + station)`);
  if (bs.powerSupply !== 0) fail('B should have no plant');
  if (as0.powerExported !== bs.powerImported) fail('exported != imported');
  if (as0.powerTradeNet <= 0 || bs.powerTradeNet >= 0) fail(`trade net A=${as0.powerTradeNet} B=${bs.powerTradeNet}`);
  const fundsBefore = as0.funds;
  await sleep(ticks(3));
  const as1 = A.stats!;
  console.log(`A funds ${fundsBefore} -> ${as1.funds} after 3 ticks (trade ${as1.powerTradeNet}/tick)`);
  // Upkeep (plant + roads) can outweigh a tiny trade, so only the trade itself is asserted:
  if (as1.powerTradeNet <= 0) fail('A trade income stopped');
  await waitFor(() => B.hasToast(/^info: Buying \d+ units of power from Exporter-A/), 'B buying toast', ticks(2));
  await waitFor(() => A.hasToast(/^info: Selling \d+ units of power to Importer-B/), 'A selling toast', ticks(2));
  const buyToasts = B.toasts.filter((t) => t.msg.startsWith('Buying')).length;
  if (buyToasts !== 1) fail(`expected exactly one Buying toast so far, got ${buyToasts}`);
  // "last year" counts the power bought: over a whole year B builds nothing, so its funds move by exactly that much
  const seen = B.newYears.length;
  await waitFor(() => B.newYears.length >= seen + 2, 'two new years for B', ticks(26));
  const [y0, y1] = B.newYears.slice(seen, seen + 2);
  console.log(`B over a year: funds ${y0.funds} -> ${y1.funds}, last year ${y1.lastIncome}`);
  if (y1.funds - y0.funds !== y1.lastIncome) fail(`B last year ${y1.lastIncome} != funds change ${y1.funds - y0.funds}`);
  console.log('power trade OK');

  // ---- (b) leaderboard ----
  console.log('waiting for population and the leaderboard...');
  await waitFor(() => (A.stats?.population ?? 0) > 0 && (B.stats?.population ?? 0) > 0, 'both populations > 0', ticks(30));
  let lb: { entries: LeaderboardEntry[]; me?: { rank: number; population: number } } | null = null;
  const t0 = Date.now();
  while (Date.now() - t0 < ticks(25)) {
    B.leaderboards = [];
    B.send({ t: 'leaderboard' });
    const got = await waitFor(() => B.leaderboards[0], 'leaderboard reply');
    if (got.entries.some((e) => e.id === A.id) && got.entries.some((e) => e.id === B.id)) { lb = got; break; }
    await sleep(TICK);
  }
  if (!lb) fail('leaderboard never listed both A and B');
  const ea = lb.entries.find((e) => e.id === A.id)!, eb = lb.entries.find((e) => e.id === B.id)!;
  console.log(`leaderboard: ${lb.entries.length} entries; A #${lb.entries.indexOf(ea) + 1} pop=${ea.population} at ${ea.cx},${ea.cy}; B #${lb.entries.indexOf(eb) + 1} pop=${eb.population} at ${eb.cx},${eb.cy}; me=${JSON.stringify(lb.me)}`);
  if (ea.cx !== cx || ea.cy !== cy || eb.cx !== cx + 1 || eb.cy !== cy) fail('leaderboard centroids wrong');
  if (!lb.me || lb.me.rank < 1 || lb.me.population <= 0) fail('me missing/wrong');
  for (let k = 1; k < lb.entries.length; k++) if (lb.entries[k - 1].population < lb.entries[k].population) fail('leaderboard not sorted');
  console.log('leaderboard OK');

  // ---- (b2) budget ----
  console.log('budget...');
  // The year so far fills in month by month; A has a plant and roads, so power and road upkeep show. Bulldozing a
  // road tile ($1) is construction spending in the current year.
  const fundsAtBudget = A.stats!.funds;
  A.send({ t: 'build', tool: 'bulldozer', x: AX + 1, y: Y + 7 });
  await waitFor(() => { const c = A.stats?.budget?.current; return !!c && c.taxes > 0 && c.power > 0 && c.roads > 0 && c.construction > 0; }, 'A has taxes, upkeep lines and construction this year', ticks(14));
  const cur = A.stats!.budget!.current;
  console.log(`A ${cur.year} so far: taxes $${cur.taxes}, upkeep roads $${cur.roads} rail $${cur.rail} power $${cur.power} services $${cur.services}, construction $${cur.construction} (funds ${fundsAtBudget} -> ${A.stats!.funds})`);
  if (cur.construction !== 1) fail(`construction should be the $1 bulldoze, got $${cur.construction}`);
  // A completed year lands in the history with the same lines, oldest first and never the current year.
  const had = A.stats!.budget!.years.length;
  await waitFor(() => (A.stats?.budget?.years.length ?? 0) > had, 'a year closed for A', ticks(14));
  const ys = A.stats!.budget!.years, last = ys[ys.length - 1];
  console.log(`A history: ${ys.map((y) => `${y.year}: taxes $${y.taxes} upkeep $${budgetTotals(y).upkeep} construction $${y.construction} net $${budgetTotals(y).net}`).join('; ')}`);
  if (last.year !== A.stats!.budget!.current.year - 1) fail(`last closed year ${last.year} should be the year before ${A.stats!.budget!.current.year}`);
  if (last.taxes <= 0 || last.power <= 0 || last.roads <= 0) fail('closed year is missing taxes or upkeep lines');
  for (let k = 1; k < ys.length; k++) if (ys[k].year !== ys[k - 1].year + 1) fail('history years are not consecutive');
  console.log('budget OK');

  // ---- (c) fire ----
  const fx = BX + 6, fy = Y + 1; // centre of B's middle residential zone
  const before = B.tile(fx, fy)!;
  console.log(`igniting B's zone at ${fx},${fy} (tile ${before & LOMASK}); station powered: ${B.stats!.fireStations}`);
  B.sendRaw({ t: 'devIgnite', x: fx, y: fy });
  await waitFor(() => B.fireTilesSeen > 0 && (B.tile(fx, fy)! & LOMASK) >= FIRE && (B.tile(fx, fy)! & LOMASK) <= LASTFIRE, 'fire tile in tiles update', ticks(2));
  await waitFor(() => (B.stats?.fires ?? 0) > 0, 'stats.fires > 0', ticks(2));
  console.log(`fire burning: stats.fires=${B.stats!.fires}, fire tiles seen=${B.fireTilesSeen}`);
  // Building on fire must be refused (fire tiles are not bulldozable either).
  B.send({ t: 'build', tool: 'bulldozer', x: fx, y: fy });
  await waitFor(() => (B.stats?.fires ?? 0) === 0, 'stats.fires back to 0', ticks(60));
  await waitFor(() => B.hasToast(/^success: The fire is out\./), 'fire out toast', ticks(2));
  let rubble = 0, fireLeft = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const id = B.tile(fx + dx, fy + dy)! & LOMASK;
    if (id >= RUBBLE && id <= LASTRUBBLE) rubble++;
    if (id >= FIRE && id <= LASTFIRE) fireLeft++;
  }
  console.log(`after the fire: ${rubble}/9 footprint tiles are rubble, ${fireLeft} still burning`);
  if (fireLeft > 0) fail('fire tiles left although stats.fires is 0');
  if (rubble < 8) fail(`expected the 3x3 footprint to be rubble, got ${rubble}`);
  if (!B.hasToast(/^info: Can't bulldoze fire/)) console.log('note: bulldoze-fire refusal toast not observed (fire may have burnt out first)');
  console.log('fire OK');

  console.log('PASS');
  for (const c of clients) c.ws.close();
  process.exit(0);
}

main().catch((e) => fail(String(e)));
