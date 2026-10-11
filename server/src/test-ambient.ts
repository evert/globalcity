// Ambient test: animation flags (coal/industrial smoke, airport radar, nuclear swirl, stadium games),
// traffic tiles, special-building counts and police stations.
// Usage (server must run with DEV_HOOKS=1 on a throwaway save dir, never the live one):
//   PORT=8796 DATA_DIR=data/save-test6 DEV_HOOKS=1 TICK_MS=500 npx tsx src/index.ts
//   PORT=8796 TICK_MS=500 npm run smoke:ambient -w server
// Exit 0 = pass. TICK_MS must match the server's so the waits are sized right. Takes ~1-2 minutes.

import WebSocket from 'ws';
import {
  DEFAULT_PORT, CHUNK, TICK_MS, LOMASK, ANIMBIT, ZONEBIT, LTRFBASE, LASTROAD, POLICE_RANGE,
  COALSMOKE1, COALSMOKE4, RADAR0, NUKESWIRL1, FULLSTADIUM, STADIUM, IZB, SMOKEBASE, COALBASE, POWERPLANT,
  lonLatToTile, chunkOf, chunkKey, decodeChunk, isWater, isRoad, isRubble, roadPiece, IND_SMOKE, ANI_TILE,
  type ClientMsg, type ServerMsg, type PlayerStats, type QueryInfo, type ToolId,
  COAL_POWER, NUCLEAR_POWER,
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
  chunks = new Map<string, Uint16Array>();
  freeSpot: { cx: number | null; cy: number | null } | null = null;
  claims = new Set<string>();
  queries: QueryInfo[] = [];
  /** tile values ever seen at watched positions (key "x,y") */
  seen = new Map<string, Set<number>>();
  watch = new Set<string>();

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
          case 'stats': this.stats = msg.stats; break;
          case 'toast': this.toasts.push({ kind: msg.kind, msg: msg.msg, at: msg.at }); break;
          case 'freeSpot': this.freeSpot = msg; break;
          case 'claim': if (msg.claim.ownerId === this.id) this.claims.add(chunkKey(msg.claim.cx, msg.claim.cy)); break;
          case 'query': this.queries.push(msg.info); break;
          case 'tiles':
            for (let k = 0; k < msg.u.length; k += 3) {
              const x = msg.u[k], y = msg.u[k + 1], v = msg.u[k + 2];
              const c = chunkOf(x, y);
              const tiles = this.chunks.get(chunkKey(c.cx, c.cy));
              if (tiles) tiles[(y - c.cy * CHUNK) * CHUNK + (x - c.cx * CHUNK)] = v;
              const key = `${x},${y}`;
              if (this.watch.has(key)) {
                let s = this.seen.get(key);
                if (!s) { s = new Set(); this.seen.set(key, s); }
                s.add(v);
              }
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
  private builds = 0;
  /** Build, pacing below the server's 40 builds/s token bucket (excess builds are silently dropped). */
  async build(tool: ToolId, x: number, y: number): Promise<void> {
    if (++this.builds % 25 === 0) await sleep(700);
    this.send({ t: 'build', tool, x, y });
  }

  tile(x: number, y: number): number {
    const c = chunkOf(x, y);
    const tiles = this.chunks.get(chunkKey(c.cx, c.cy));
    return tiles?.[(y - c.cy * CHUNK) * CHUNK + (x - c.cx * CHUNK)] ?? -1;
  }

  async findFree(cx: number, cy: number): Promise<{ cx: number; cy: number } | null> {
    this.freeSpot = null;
    this.send({ t: 'findFree', cx, cy });
    const s = await waitFor(() => this.freeSpot, 'freeSpot');
    return s.cx === null || s.cy === null ? null : { cx: s.cx, cy: s.cy };
  }

  async query(x: number, y: number): Promise<QueryInfo> {
    const n = this.queries.length;
    this.send({ t: 'query', x, y });
    return waitFor(() => this.queries[n], 'query reply');
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

const SEEDS: [number, number][] = [
  [-0.1, 51.5], [2.35, 48.85], [13.4, 52.5], [-3.7, 40.4], [21.0, 52.2], [30.5, 50.45], [37.6, 55.75],
  [-94.6, 39.1], [-87.6, 41.9], [-104.9, 39.7], [-46.6, -23.5], [151.2, -33.9], [116.4, 39.9], [77.2, 28.6],
  [3.4, 6.5], [28.0, -26.2], [-99.1, 19.4], [-58.4, -34.6], [105.8, 21.0], [44.4, 33.3],
];

// Layout, origin (X,Y) = top-left of a 25 x 13 land rectangle. Everything is powered from the coal plant through
// wires and conductive footprints.
//   rows Y..Y+5   : coal X..X+3 | wire X+4 (row Y+1) | airport X+5..X+10 | wire X+11 | stadium X+12..X+15 | wire X+16 | stadium X+17..X+20 | wire X+21 | police X+22..X+24
//   rows Y+4..Y+6 : wire column at X+1 from the plant down to the zones
//   rows Y+7..Y+9 : res X..X+2 | com X+3..X+5 | res X+6..X+8 | com X+9..X+11 | wires X+12..X+14 (row Y+8) | ind X+15..X+17 | nuclear X+19..X+22 (rows Y+7..Y+10)
//   row Y+11      : road X..X+24 ; row Y+12 free (a branch road is added during the test)
const RW = 25, RH = 13;

function findRect(tiles: Uint16Array): { ox: number; oy: number } | null {
  for (let oy = 1; oy + RH < CHUNK - 1; oy++) {
    cols: for (let ox = 1; ox + RW < CHUNK - 1; ox++) {
      for (let dy = 0; dy < RH; dy++) for (let dx = 0; dx < RW; dx++) {
        const v = tiles[(oy + dy) * CHUNK + ox + dx];
        if (isWater(v) || (v & ZONEBIT) || isRoad(v)) continue cols;
      }
      return { ox, oy };
    }
  }
  return null;
}

const idOf = (v: number): number => v & LOMASK;
const anim = (v: number): boolean => (v & ANIMBIT) !== 0;
const isTrafficTile = (v: number): boolean => idOf(v) >= LTRFBASE && idOf(v) <= LASTROAD;

async function main(): Promise<void> {
  const A = new TestClient('Ambient-A');
  await A.connect();
  console.log(`connected: A=${A.id.slice(0, 8)} tick=${TICK}ms`);

  // ANI_TILE sanity: every traffic variant we may write (pieces 2..14, light and heavy, frame 0) is animated.
  for (let piece = 2; piece <= 14; piece++) {
    for (const base of [80, 144]) {
      const id = base + piece;
      if (ANI_TILE[id] === id) fail(`ANI_TILE has no cycle for traffic tile ${id}`);
    }
  }

  // ---- site ----
  let site: { cx: number; cy: number; X: number; Y: number } | null = null;
  for (const [lon, lat] of SEEDS) {
    const t = lonLatToTile(lon, lat);
    const c = chunkOf(t.x, t.y);
    const a = await A.findFree(c.cx, c.cy);
    if (!a) continue;
    A.send({ t: 'sub', chunks: [[a.cx, a.cy]] });
    await waitFor(() => A.chunks.has(chunkKey(a.cx, a.cy)), 'chunk frame');
    const r = findRect(A.chunks.get(chunkKey(a.cx, a.cy))!);
    if (!r) continue;
    site = { cx: a.cx, cy: a.cy, X: a.cx * CHUNK + r.ox, Y: a.cy * CHUNK + r.oy };
    break;
  }
  if (!site) fail(`no free chunk with a ${RW}x${RH} land rectangle found`);
  const { cx, cy, X, Y } = site;
  console.log(`site: chunk ${cx},${cy}; rectangle from ${X},${Y}`);
  A.send({ t: 'claim', cx, cy });
  await waitFor(() => A.claims.has(chunkKey(cx, cy)), 'claim');
  A.sendRaw({ t: 'devFunds', amount: 200_000 });
  A.sendRaw({ t: 'devPeak', pop: 1_100_000 }); // seaport/airport are milestone buildings
  await waitFor(() => (A.stats?.funds ?? 0) > 100_000, 'devFunds');

  // Positions of interest (centres = footprint top-left + (1,1)).
  const coal = { x: X + 1, y: Y + 1 };
  const airport = { x: X + 6, y: Y + 1 };
  const stadiums = [{ x: X + 13, y: Y + 1 }, { x: X + 18, y: Y + 1 }];
  const police = { x: X + 23, y: Y + 1 };
  const zones = [{ tool: 'residential', x: X + 1 }, { tool: 'commercial', x: X + 4 }, { tool: 'residential', x: X + 7 }, { tool: 'commercial', x: X + 10 }] as const;
  const ZY = Y + 8;
  const ind = { x: X + 16, y: ZY };
  const indWire = { x: X + 13, y: ZY };
  const nuclear = { x: X + 20, y: ZY };
  const ROAD_Y = Y + 11;
  const smokeCells = [{ x: coal.x + 1, y: coal.y - 1 }, { x: coal.x + 2, y: coal.y - 1 }, { x: coal.x + 1, y: coal.y }, { x: coal.x + 2, y: coal.y }];
  const radar = { x: airport.x + 1, y: airport.y - 1 };
  const swirl = { x: nuclear.x, y: nuclear.y + 1 };
  for (const s of stadiums) { A.watch.add(`${s.x},${s.y}`); A.watch.add(`${s.x + 1},${s.y}`); A.watch.add(`${s.x + 1},${s.y + 1}`); }

  // ---- build ----
  await A.build('coal', coal.x, coal.y);
  await A.build('wire', X + 4, Y + 1);
  await A.build('airport', airport.x, airport.y);
  await A.build('wire', X + 11, Y + 1);
  await A.build('stadium', stadiums[0].x, stadiums[0].y);
  await A.build('wire', X + 16, Y + 1);
  await A.build('stadium', stadiums[1].x, stadiums[1].y);
  await A.build('wire', X + 21, Y + 1);
  await A.build('police', police.x, police.y);
  for (let dy = 4; dy <= 6; dy++) await A.build('wire', X + 1, Y + dy);
  for (const z of zones) await A.build(z.tool, z.x, ZY);
  for (let dx = 12; dx <= 14; dx++) await A.build('wire', X + dx, ZY);
  await A.build('industrial', ind.x, ind.y);
  await A.build('nuclear', nuclear.x, nuclear.y);
  for (let dx = 0; dx < RW; dx++) await A.build('road', X + dx, ROAD_Y);
  await sleep(500);
  if (A.hasToast(/^error/)) fail('error toast while building');
  const builtAt = Date.now();

  // ---- (a) coal smoke, radar, swirl, specials, police ----
  console.log('waiting for animation tiles...');
  await waitFor(() => smokeCells.every((c) => anim(A.tile(c.x, c.y)) && idOf(A.tile(c.x, c.y)) >= COALSMOKE1 && idOf(A.tile(c.x, c.y)) <= COALSMOKE4 + 3), 'coal smoke tiles', ticks(3));
  console.log(`coal smoke: ${smokeCells.map((c) => idOf(A.tile(c.x, c.y))).join(',')}`);
  await waitFor(() => anim(A.tile(radar.x, radar.y)) && idOf(A.tile(radar.x, radar.y)) === RADAR0, 'airport radar tile', ticks(3));
  await waitFor(() => anim(A.tile(swirl.x, swirl.y)) && idOf(A.tile(swirl.x, swirl.y)) === NUKESWIRL1, 'nuclear swirl tile', ticks(3));
  await waitFor(() => A.stats?.policeStations === 1 && A.stats.specials.airport <= 1 && A.stats.specials.stadium === 2, 'stats.policeStations/specials', ticks(3));
  // the airport only counts when another mayor has one to fly to (smoke:flights covers that), so 0 or 1 here
  const s0 = A.stats!;
  console.log(`stats: police=${s0.policeStations} specials=${JSON.stringify(s0.specials)} crime=${s0.crime} demand=${JSON.stringify(s0.demand)} supply=${s0.powerSupply}`);
  // one coal plant + one nuclear plant
  if (s0.powerSupply !== COAL_POWER + NUCLEAR_POWER) fail(`power supply ${s0.powerSupply}, expected ${COAL_POWER + NUCLEAR_POWER}`);
  if (s0.specials.seaport !== 0) fail('no seaport was built');
  const q = await A.query(police.x, police.y);
  if (q.name !== `Police station (covers ${POLICE_RANGE} tiles)` || !q.powered) fail(`police query: ${JSON.stringify(q)}`);
  console.log(`query: ${q.name}, powered=${q.powered}`);
  console.log('animation flags + specials OK');

  // ---- (b) traffic ----
  console.log('waiting for traffic...');
  const roadTiles = (): number[] => Array.from({ length: RW }, (_, dx) => A.tile(X + dx, ROAD_Y));
  // A test town is far too small to jam its roads under the real trip rules, so pump density in through
  // the dev hook (one burst per tick) until section (d), where the zones go and the roads must clear.
  const pump = setInterval(() => { for (let dx = 0; dx < RW; dx++) A.sendRaw({ t: 'devTraffic', x: X + dx, y: ROAD_Y, amount: 255 }); }, TICK);
  await waitFor(() => roadTiles().some((v) => isTrafficTile(v)) && (A.stats?.traffic ?? 0) > 0, 'traffic tiles and stats.traffic > 0', ticks(15));
  let tr = roadTiles();
  const trafficCount = tr.filter(isTrafficTile).length;
  console.log(`traffic: ${trafficCount}/${RW} road tiles are traffic variants, stats.traffic=${A.stats!.traffic}; ids ${tr.map(idOf).join(' ')}`);
  for (const v of tr) {
    if (!isRoad(v)) fail(`road tile lost: ${idOf(v)}`);
    if (isTrafficTile(v) !== anim(v)) fail(`ANIMBIT mismatch on road tile ${v.toString(16)}`);
    if (isTrafficTile(v) && ANI_TILE[idOf(v)] === idOf(v)) fail(`traffic tile ${idOf(v)} has no animation cycle`);
  }
  // Re-tabling a trafficked road: a branch below the road turns the tile above into a T junction at the same level.
  const bx = X + 5;
  const before = A.tile(bx, ROAD_Y);
  await A.build('road', bx, ROAD_Y + 1);
  await waitFor(() => roadPiece(idOf(A.tile(bx, ROAD_Y))) === 10, 'T junction piece (ROADS9) above the branch', ticks(1));
  const after = A.tile(bx, ROAD_Y);
  console.log(`branch: ${idOf(before)} -> ${idOf(after)} (piece ${roadPiece(idOf(after))}, traffic ${isTrafficTile(after)}, anim ${anim(after)})`);
  if (isTrafficTile(before) && !isTrafficTile(after) && !isTrafficTile(A.tile(bx, ROAD_Y))) fail('re-tabling dropped the traffic level');
  const tq = await A.query(bx, ROAD_Y);
  console.log(`query: ${tq.name}`);
  console.log('traffic OK');

  // ---- (c) industrial smoke ----
  console.log('waiting for an industrial building...');
  await waitFor(() => idOf(A.tile(ind.x, ind.y)) >= IZB, 'industrial building', ticks(120));
  const indId = idOf(A.tile(ind.x, ind.y));
  const variant = ((indId - IZB) >> 3) & 7;
  const e = IND_SMOKE[variant];
  console.log(`industrial centre ${indId}, variant ${variant}, animates=${e.animates}`);
  if (e.animates) {
    const cells = [e.a, e.b].map((s) => ({ x: ind.x + s.dx, y: ind.y + s.dy, on: s.on }));
    await waitFor(() => cells.every((c) => anim(A.tile(c.x, c.y)) && idOf(A.tile(c.x, c.y)) === c.on), 'industrial smoke tiles', ticks(3));
    console.log(`industrial smoke: ${cells.map((c) => idOf(A.tile(c.x, c.y))).join(',')}`);
    await A.build('bulldozer', indWire.x, indWire.y);
    await waitFor(() => cells.every((c) => !anim(A.tile(c.x, c.y)) && idOf(A.tile(c.x, c.y)) < SMOKEBASE), 'industrial smoke off after the wire was cut', ticks(4));
    console.log(`unpowered: ${cells.map((c) => idOf(A.tile(c.x, c.y))).join(',')}`);
  } else {
    await A.build('bulldozer', indWire.x, indWire.y);
  }
  console.log('industrial smoke OK');

  // ---- (d) traffic decays when the zones go ----
  clearInterval(pump);
  for (const z of zones) await A.build('bulldozer', z.x, ZY);
  await sleep(300);
  for (const z of zones) if (!isRubble(A.tile(z.x, ZY))) fail(`zone at ${z.x},${ZY} not bulldozed`);
  console.log('zones bulldozed; waiting for traffic to decay...');
  await waitFor(() => roadTiles().every((v) => isRoad(v) && !isTrafficTile(v) && !anim(v)) && A.stats?.traffic === 0, 'plain roads and stats.traffic = 0', ticks(45));
  tr = roadTiles();
  console.log(`roads plain again: ids ${tr.map(idOf).join(' ')}`);
  console.log('traffic decay OK');

  // ---- (e) stadium game (p = 1/32 per powered stadium per tick; two stadiums) ----
  const sawGame = (): boolean => stadiums.some((s) => [...(A.seen.get(`${s.x},${s.y}`) ?? [])].some((v) => idOf(v) === FULLSTADIUM));
  const left = Math.max(0, ticks(250) - (Date.now() - builtAt));
  if (!sawGame()) console.log(`waiting up to ${Math.round(left / 1000)} s for a stadium game...`);
  await waitFor(sawGame, 'FULLSTADIUM centre tile', left + 1000);
  const current = stadiums.map((s) => idOf(A.tile(s.x, s.y)));
  console.log(`stadium centres now: ${current.join(',')} (${STADIUM} empty, ${FULLSTADIUM} game on)`);
  // The game tiles (932 and 940, ANIMBIT) must have been placed with every game; a game lasts ~8 ticks so check the history.
  const played = stadiums.find((s) => [...(A.seen.get(`${s.x},${s.y}`) ?? [])].some((v) => idOf(v) === FULLSTADIUM))!;
  const seenGame = (dx: number, dy: number, id: number): boolean => [...(A.seen.get(`${played.x + dx},${played.y + dy}`) ?? [])].some((v) => idOf(v) === id && anim(v));
  if (!seenGame(1, 0, 932) || !seenGame(1, 1, 940)) fail('FOOTBALLGAME tiles with ANIMBIT were not placed with the game');
  const full = stadiums.find((s) => idOf(A.tile(s.x, s.y)) === FULLSTADIUM);
  if (full) {
    const sq = await A.query(full.x + 1, full.y);
    console.log(`query on a game tile: ${sq.name}`);
    if (!/Stadium \(game on!\)/.test(sq.name)) fail(`stadium query: ${sq.name}`);
  }
  console.log('stadium OK');

  // ---- (f) bulldozing a smoke tile takes the whole plant ----
  await A.build('bulldozer', smokeCells[0].x, smokeCells[0].y);
  await waitFor(() => isRubble(A.tile(coal.x, coal.y)) && smokeCells.every((c) => isRubble(A.tile(c.x, c.y))), 'coal plant rubble', ticks(1));
  if (idOf(A.tile(coal.x - 1, coal.y - 1)) === COALBASE || idOf(A.tile(coal.x, coal.y)) === POWERPLANT) fail('coal plant footprint left behind');
  console.log('bulldozing via a smoke tile OK');

  console.log('PASS');
  for (const c of clients) c.ws.close();
  process.exit(0);
}

main().catch((e) => fail(String(e)));
