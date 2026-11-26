// Dev helper: fills a save with fake, fully built cities at real places, to see how the map looks with a busy
// world at every zoom. Never run it against a real save: it adds made-up players.
//
//   npx tsx scripts/seed-demo-cities.ts <save dir> [count] [--spacing <chunks>] [--fill <share>] [--live]
//   (the server must NOT be running on that save)
//
// count: how many cities at real places (default 90); --spacing: least distance between them in chunks (default 12;
// 3 puts one at nearly every place in the data); --fill: then keep founding cities on free land until this share
// (0..1) of the chunks with real land is claimed, named after the nearest place ("New Lyon", "Lyon Heights").
//
// Bigger places get more plots. Cities are laid out SimCity-style: a road grid with 3x3 zones, commercial in the
// centre, homes around it, industry, a coal plant and sometimes an airport or stadium at the edge, busy roads
// in the middle. Every building is powered. The mayors were "last seen" 20 minutes ago, so the simulation keeps
// the cities frozen exactly like this (and lit at night) instead of growing or decaying them. With --live the
// cities take part in the simulation instead (run the server with ALL_ONLINE=1 to keep them all running).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  WORLD_W, WORLD_H, CHUNK, CHUNKS_X, CHUNKS_Y, WORLD_TAG, LOMASK, ZONEBIT, BULLBIT, PWRBIT, ANIMBIT, BNCNBIT, BLBNBIT,
  ROADBASE, ROAD_TABLE, HROADPOWER, VROADPOWER, LHPOWER, LVPOWER, CONDBIT, BLBNCNBIT, COALBASE, AIRPORTBASE, STADIUMBASE, FIRESTBASE, POLICESTBASE, WOODS2, DIRT,
  resBuildingCenter, comBuildingCenter, indBuildingCenter, resZonePop, comZonePop, indZonePop, displayPopulation,
  trafficTile, colorForId, isWater, baseIsWater, chunkKey,
} from '@globalcity/shared';
import { bootWorld } from '../src/world.ts';

const root = path.resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const flag = (name: string): number | null => { const i = args.indexOf(name); if (i < 0) return null; const v = Number(args[i + 1]); args.splice(i, 2); return v; };
const SPACING = flag('--spacing') ?? 12, FILL = flag('--fill') ?? 0;
const LIVE = args.includes('--live'); if (LIVE) args.splice(args.indexOf('--live'), 1);
const saveDir = path.resolve(root, args[0] ?? '');
const COUNT = Number(args[1]) || 90;
if (!args[0] || !fs.existsSync(path.join(saveDir, 'state.json'))) {
  console.error('usage: npx tsx scripts/seed-demo-cities.ts <save dir with a state.json> [count]');
  process.exit(1);
}
const worldDir = path.join(root, `data/world-${WORLD_TAG}`);
const world = bootWorld(path.join(worldDir, 'base.bin'));
const T = world.tiles, B = world.base;
const places: [string, number, number, number, string][] = JSON.parse(fs.readFileSync(path.join(worldDir, 'places.json'), 'utf8')).places;
const state = JSON.parse(fs.readFileSync(path.join(saveDir, 'state.json'), 'utf8'));
const claimed = new Set<string>(state.claims.map((c: [string, string]) => c[0]));

let seed = 12345;
const rand = (): number => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
const landIn = (cx: number, cy: number): number => {
  let n = 0;
  for (let y = cy * CHUNK; y < cy * CHUNK + CHUNK; y++) for (let x = cx * CHUNK; x < cx * CHUNK + CHUNK; x++) if (!baseIsWater(B[y * WORLD_W + x])) n++;
  return n;
};

// ---- which places ----
// the biggest places, spread out; a few small towns; and some on ice, snow and sand to see those biomes built on
const SHOWCASE = ['Nuuk', 'Reykjavík', 'Murmansk', 'Norilsk', 'Yakutsk', 'Anchorage', 'Yellowknife', 'Tromsø', 'Longyearbyen',
  'Riyadh', 'Dubai', 'Phoenix', 'Las Vegas', 'Alice Springs', 'Ulaanbaatar', 'Timbuktu', 'Nouakchott', 'Tamanrasset', 'Kashgar', 'Ushuaia'];
const picked: { name: string; x: number; y: number; pop: number }[] = [];
const farEnough = (x: number, y: number, minChunks: number) => picked.every((p) => Math.hypot(p.x - x, p.y - y) >= minChunks * CHUNK);
for (const name of SHOWCASE) {
  const p = places.find((q) => q[0] === name);
  if (p && farEnough(p[1], p[2], 6)) picked.push({ name: p[0], x: p[1], y: p[2], pop: Math.max(p[3], 300_000) });
}
for (const p of places) {
  if (picked.length >= COUNT * 0.75) break;
  if (farEnough(p[1], p[2], SPACING)) picked.push({ name: p[0], x: p[1], y: p[2], pop: p[3] });
}
for (let tries = 0; picked.length < COUNT && tries < 5000; tries++) {
  const p = places[300 + Math.floor(rand() * Math.min(3000, places.length - 300))];
  if (p && farEnough(p[1], p[2], Math.min(8, SPACING))) picked.push({ name: p[0], x: p[1], y: p[2], pop: 50_000 });
}

const plotsFor = (pop: number): number => pop >= 15e6 ? 10 : pop >= 8e6 ? 8 : pop >= 4e6 ? 6 : pop >= 2e6 ? 4 : pop >= 800e3 ? 3 : pop >= 200e3 ? 2 : 1;
const template = state.players.find((p: { stats?: unknown }) => p.stats)?.stats;
if (!template) { console.error('the save needs at least one player to copy stats from (open the game once)'); process.exit(1); }

const now = Date.now();
let made = 0, plots = 0;
const usedNames = new Set<string>(state.players.map((p: { cityName?: string }) => (p.cityName ?? '').toLowerCase()));
function makeCity(city: { name: string; x: number; y: number; pop: number }): boolean {
  // plots: the place's chunk and its nearest neighbours with enough land
  const ccx = Math.floor(city.x / CHUNK), ccy = Math.floor(city.y / CHUNK);
  const want = plotsFor(city.pop);
  const cand: { cx: number; cy: number; d: number }[] = [];
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    const cx = ccx + dx, cy = ccy + dy;
    if (cx < 0 || cy < 0 || cx >= CHUNKS_X || cy >= CHUNKS_Y || claimed.has(chunkKey(cx, cy))) continue;
    cand.push({ cx, cy, d: Math.hypot(dx, dy) + rand() * 0.3 });
  }
  cand.sort((a, b) => a.d - b.d);
  const chunks: { cx: number; cy: number }[] = [];
  for (const c of cand) {
    if (chunks.length >= want) break;
    // keep the city in one piece: each plot must touch one already taken
    if (chunks.length && !chunks.some((o) => Math.abs(o.cx - c.cx) + Math.abs(o.cy - c.cy) === 1)) continue;
    if (landIn(c.cx, c.cy) < 1600) continue;
    chunks.push(c);
  }
  if (!chunks.length) return false;
  const mine = new Set(chunks.map((c) => chunkKey(c.cx, c.cy)));
  const inCity = (x: number, y: number) => x >= 0 && y >= 0 && x < WORLD_W && y < WORLD_H && mine.has(chunkKey(Math.floor(x / CHUNK), Math.floor(y / CHUNK)));
  const dry = (x: number, y: number) => inCity(x, y) && !isWater(T[y * WORLD_W + x]);
  const R = Math.sqrt(chunks.length) * CHUNK * 0.62;
  const rOf = (x: number, y: number) => Math.hypot(x - city.x, y - city.y) / R;

  // the road grid: every 7th row and column inside the city
  const x0 = Math.min(...chunks.map((c) => c.cx)) * CHUNK, x1 = (Math.max(...chunks.map((c) => c.cx)) + 1) * CHUNK;
  const y0 = Math.min(...chunks.map((c) => c.cy)) * CHUNK, y1 = (Math.max(...chunks.map((c) => c.cy)) + 1) * CHUNK;
  const road = new Set<number>();
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if ((x % 7 === 0 || y % 7 === 0) && dry(x, y) && rOf(x, y) < 1.25) road.add(y * WORLD_W + x);

  const pops = { res: 0, com: 0, ind: 0 };
  const put = (x: number, y: number, size: number, base: number) => {
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) {
      let v = (base + dy * size + dx) | BNCNBIT | PWRBIT;
      if (dx === 1 && dy === 1) v |= ZONEBIT | BULLBIT;
      T[(y + dy) * WORLD_W + x + dx] = v;
    }
  };
  const fits = (x: number, y: number, size: number) => {
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) if (!dry(x + dx, y + dy) || road.has((y + dy) * WORLD_W + x + dx)) return false;
    return true;
  };
  // a live city needs real power: a coal plant powers 400 zones and a built-up plot has about 300, so one per plot
  // and one spare (one is enough for a frozen picture)
  let plants = 0, airport = chunks.length < 4, stadium = chunks.length < 6;
  const wantPlants = LIVE ? chunks.length + 1 : 1;
  const blocks: { bx: number; by: number; r: number }[] = [];
  for (let by = Math.ceil(y0 / 7) * 7 + 1; by + 6 <= y1; by += 7) for (let bx = Math.ceil(x0 / 7) * 7 + 1; bx + 6 <= x1; bx += 7) blocks.push({ bx, by, r: rOf(bx + 3, by + 3) });
  blocks.sort((a, b) => b.r - a.r); // the edge first, so the plant and airport get outer blocks
  for (const { bx, by, r } of blocks) {
    if (r > 1.15) continue;
    // a frozen picture puts its plant at the edge; a live city's plants go in the built-up ring, where unbroken
    // zones carry their power everywhere (the thinned-out fringe has gaps that would cut them off)
    // (blocks come edge first, so a small town without room in that ring still gets one in its centre)
    if (plants < wantPlants && (LIVE ? (r > 0.3 && r < 0.7) || (plants === 0 && r <= 0.3) : r > 0.7) && fits(bx + 1, by + 1, 4)) {
      put(bx + 1, by + 1, 4, COALBASE); plants++;
      // the plant sits a tile in from the block's edge: wire it to the power crossings in the roads west and north
      if (LIVE && dry(bx, by + 2)) T[(by + 2) * WORLD_W + bx] = LHPOWER | BLBNCNBIT;
      if (LIVE && dry(bx + 2, by)) T[by * WORLD_W + bx + 2] = LVPOWER | BLBNCNBIT;
      continue;
    }
    if (!airport && r > 0.6 && fits(bx, by, 6)) { put(bx, by, 6, AIRPORTBASE); airport = true; continue; }
    if (!stadium && r > 0.35 && r < 0.6 && fits(bx + 1, by + 1, 4)) { put(bx + 1, by + 1, 4, STADIUMBASE); stadium = true; continue; }
    for (const [ox, oy] of [[0, 0], [3, 0], [0, 3], [3, 3]]) {
      const zx = bx + ox, zy = by + oy;
      if (!fits(zx, zy, 3)) continue;
      const rr = rOf(zx + 1, zy + 1), u = rand();
      if (rr > 0.95 && u < 0.5) continue; // the fringe thins out into the landscape
      const value = rr < 0.3 ? 3 : rr < 0.55 ? 2 : rr < 0.8 ? 1 : 0;
      let centre: number;
      if (rr < 0.3 ? u < 0.65 : rr < 0.75 ? u < 0.12 : false) {
        centre = comBuildingCenter(Math.min(4, Math.floor((1 - rr) * 4.5 * (0.6 + rand() * 0.4))), value); pops.com += comZonePop(centre);
      } else if (rr > 0.7 && u > 0.55) {
        centre = indBuildingCenter(Math.min(3, Math.floor(rand() * 4)), rr > 0.9 ? 0 : 1); pops.ind += indZonePop(centre);
      } else if (u > 0.97) { put(zx, zy, 3, rand() < 0.5 ? FIRESTBASE : POLICESTBASE); continue; }
      else if (u > 0.93 && rr > 0.3) {
        for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) T[(zy + dy) * WORLD_W + zx + dx] = (WOODS2 + Math.floor(rand() * 4)) | BLBNBIT;
        continue;
      } else {
        centre = resBuildingCenter(Math.min(3, Math.floor((1.2 - rr) * 3 * (0.5 + rand() * 0.5))), value); pops.res += resZonePop(centre);
      }
      put(zx, zy, 3, (centre & LOMASK) - 4);
    }
  }
  // roads, shaped by their neighbours; the middle is busy
  for (const i of road) T[i] = DIRT;
  const isRoad = (x: number, y: number) => road.has(y * WORLD_W + x);
  for (const i of road) {
    const x = i % WORLD_W, y = Math.floor(i / WORLD_W);
    const mask = (isRoad(x, y - 1) ? 1 : 0) | (isRoad(x + 1, y) ? 2 : 0) | (isRoad(x, y + 1) ? 4 : 0) | (isRoad(x - 1, y) ? 8 : 0);
    const piece = ROAD_TABLE[mask] - ROADBASE, r = rOf(x, y), u = rand();
    const level = r < 0.35 && u < 0.45 ? 2 : r < 0.65 && u < 0.35 ? 1 : 0;
    T[i] = trafficTile(piece, level, Math.floor(rand() * 4)) | BLBNBIT | (level ? ANIMBIT : 0);
    // live cities: roads don't carry power, so the middle of every road between two blocks gets a power line
    // across it, and the plant's power reaches every block (zones pass it on to the zones they touch)
    if (LIVE && mask === 5 && y % 7 === 3) T[i] = VROADPOWER | CONDBIT | BLBNBIT; // vertical road, wire east-west
    else if (LIVE && mask === 10 && x % 7 === 3) T[i] = HROADPOWER | CONDBIT | BLBNBIT; // horizontal road, wire north-south
  }

  // the mayor
  const id = crypto.randomUUID();
  const population = displayPopulation(pops.res, pops.com, pops.ind);
  const keys = chunks.map((c) => chunkKey(c.cx, c.cy));
  state.players.push({
    id, token: crypto.randomBytes(16).toString('hex'), name: `Demo ${city.name}`, cityName: city.name, color: colorForId(id),
    funds: 50_000, chunks: keys, createdAt: now - 86_400_000, lastSeen: now - 20 * 60_000, active: LIVE, yearIncome: 0, peakPop: population,
    stats: { ...template, funds: 50_000, population, resPop: pops.res, comPop: pops.com, indPop: pops.ind, chunks: keys.length, peakPop: population },
  });
  for (const k of keys) { state.claims.push([k, id]); claimed.add(k); }
  for (const c of chunks) {
    const buf = Buffer.from(Uint16Array.from(world.chunkView(c.cx, c.cy), (v) => v & 0xffff).buffer); // saves hold kind + flags
    fs.writeFileSync(path.join(saveDir, 'chunks', `${c.cx}_${c.cy}.bin`), buf);
  }
  made++; plots += chunks.length;
  usedNames.add(city.name.toLowerCase());
  if (made <= 200 || made % 500 === 0) console.log(`${city.name}: ${chunks.length} plot(s), ${population.toLocaleString()} people`);
  return true;
}
for (const city of picked) makeCity(city);

// fill: found cities on free land until FILL of the land chunks are claimed
if (FILL > 0) {
  const landy: { cx: number; cy: number }[] = [];
  for (let cy = 0; cy < CHUNKS_Y; cy++) for (let cx = 0; cx < CHUNKS_X; cx++) if (landIn(cx, cy) >= 1600) landy.push({ cx, cy });
  for (let i = landy.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [landy[i], landy[j]] = [landy[j], landy[i]]; }
  const target = Math.round(landy.length * FILL);
  const PRE = ['New ', 'East ', 'West ', 'North ', 'South ', 'Port ', 'Upper ', 'Lower ', 'Fort ', 'Lake ', 'Mount ', 'Little '];
  const POST = [' Heights', ' Park', ' Springs', ' Hills', ' Falls', ' Junction', ' Harbour', ' Crossing', ' Vale', ' Ridge', ' Bay', ' Fields'];
  const nearest = (x: number, y: number): string => {
    let best = places[0][0], bd = Infinity;
    for (const p of places) { const d = (p[1] - x) ** 2 + (p[2] - y) ** 2; if (d < bd) { bd = d; best = p[0]; } }
    return best;
  };
  const claimedLand = () => landy.filter((c) => claimed.has(chunkKey(c.cx, c.cy))).length;
  let have = claimedLand();
  for (const c of landy) {
    if (have >= target) break;
    if (claimed.has(chunkKey(c.cx, c.cy))) continue;
    const x = c.cx * CHUNK + 16 + Math.floor(rand() * 32), y = c.cy * CHUNK + 16 + Math.floor(rand() * 32);
    const base = nearest(x, y);
    let name = '';
    for (let k = 0; k < 30 && (!name || usedNames.has(name.toLowerCase())); k++) name = rand() < 0.5 ? PRE[Math.floor(rand() * PRE.length)] + base : base + POST[Math.floor(rand() * POST.length)];
    if (usedNames.has(name.toLowerCase())) name = `${base} ${made}`;
    const u = rand(), pop = u < 0.5 ? 100_000 : u < 0.8 ? 500_000 : u < 0.95 ? 1_500_000 : 5_000_000;
    const before = plots;
    if (makeCity({ name, x, y, pop })) have += plots - before;
  }
  console.log(`fill: ${have} of ${landy.length} land chunks claimed (${Math.round((have / landy.length) * 100)}%)`);
}
fs.writeFileSync(path.join(saveDir, 'state.json'), JSON.stringify(state));
console.log(`${made} demo cities, ${plots} plots written to ${saveDir}`);
