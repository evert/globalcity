// The client's build prediction gives the same tiles as the server for a sequence of builds, and settles back to
// the server's tiles. Runs the shared rules twice: on a plain world (the server's way: tools.ts is a thin wrapper
// over the same function) and through the client's Predictor over a TileMap. No server needed:
//   npm test -w client
import {
  CHUNK,
  WORLD_W,
  LOMASK,
  LOOK_BITS,
  LOOK_SHIFT,
  CUSTOM_BUILDINGS,
  DIRT,
  RIVER,
  WOODS,
  CUSTOMCENTRE,
  ZONEBIT,
  applyBuildRules,
  countCustomIn,
  countMilestoneIn,
  chunkKey,
  type BuildBuilding,
  type BuildPlayer,
  type BuildRng,
  type BuildWorld,
  type PlayerStats,
  type ToolId,
} from '@globalcity/shared';
import { TileMap } from '../src/map.ts';
import { CustomLayer } from '../src/custom.ts';
import { Predictor, PREDICTION_TIMEOUT_MS } from '../src/predict.ts';

declare const process: { exit(code: number): never }; // (node; the client has no node types)

let failures = 0;
const check = (ok: boolean, msg: string): void => {
  if (!ok) {
    failures++;
    console.log('FAIL:', msg);
  }
};

// one owned chunk at (10,10), unowned (11,10) loaded beside it
const CX = 10,
  CY = 10,
  X0 = CX * CHUNK,
  Y0 = CY * CHUNK;
const owned = (cx: number, cy: number) => cx === CX && cy === CY;
const idx = (x: number, y: number) => y * WORLD_W + x;
/** a fixed look per place (even looks: unfrozen skins), standing in for the server's biome skin */
const lookAtPlace = (x: number, y: number) => (((x * 7 + y * 3) % 3) * 2) << LOOK_SHIFT;
function terrain(x: number, y: number): number {
  const dy = y - Y0,
    dx = x - X0;
  if (dy >= 40 && dy < 44) return RIVER; // a river across the chunk
  if ((dx * 13 + dy * 7) % 11 === 0) return WOODS;
  return DIRT;
}

// ---- the server's way: a world that stamps a look on write ----
class RefWorld implements BuildWorld {
  readonly tiles = new Map<number, number>();
  readonly reg = new Map<string, BuildBuilding>();
  readonly changed = new Set<number>();
  get(x: number, y: number): number {
    return this.tiles.get(idx(x, y)) ?? terrain(x, y) | lookAtPlace(x, y);
  }
  set(x: number, y: number, v: number): void {
    this.tiles.set(idx(x, y), ((v & 0xffff) | lookAtPlace(x, y)) >>> 0);
    this.changed.add(idx(x, y));
  }
  frozen(): boolean {
    return false;
  }
  readonly buildings = {
    at: (x: number, y: number) => {
      for (const b of this.reg.values()) if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return b;
      return undefined;
    },
    add: (kind: string, x: number, y: number) => {
      const d = CUSTOM_BUILDINGS[kind];
      this.reg.set(`${x},${y}`, { kind, x, y, w: d.w, h: d.h });
    },
    remove: (b: BuildBuilding) => {
      this.reg.delete(`${b.x},${b.y}`);
    },
  };
}
const ref = new RefWorld();
let funds = 100_000;
const unlocked = ['university', 'fire'];
const refPlayer: BuildPlayer = {
  get funds() {
    return funds;
  },
  ownsChunk: owned,
  unlocked: () => unlocked,
  inSeason: () => true,
  railLinked: false,
  countMilestone: (b) => countMilestoneIn(ref, [chunkKey(CX, CY)], b),
  countCustom: (k) => countCustomIn(ref, [chunkKey(CX, CY)], k),
};

// ---- the client's way ----
const map = new TileMap();
for (const cx of [CX, CX + 1]) {
  const a = new Uint32Array(CHUNK * CHUNK);
  for (let dy = 0; dy < CHUNK; dy++)
    for (let dx = 0; dx < CHUNK; dx++) {
      const x = cx * CHUNK + dx,
        y = Y0 + dy;
      a[dy * CHUNK + dx] = ref.get(x, y);
    }
  map.setChunk(cx, CY, a);
}
const customs = new CustomLayer();
const stats = { funds, unlocked, inSeason: [] } as unknown as PlayerStats;
const state = {
  get funds() {
    return stats.funds;
  },
  stats,
  ownsChunk: owned,
  myChunks: () => [{ cx: CX, cy: CY }],
};
let clock = 0;
// both sides draw the same "random" numbers, so rubble variants match
const seeded = (): BuildRng => {
  let s = 1;
  return (n) => {
    s = (s * 1103515245 + 12345) >>> 0;
    return (s >>> 16) % (n + 1);
  };
};
const refRng = seeded();
const predictor = new Predictor(map, customs, state, () => clock, seeded());

/** Every tile either side touched, compared on kind and flags (looks: the client keeps the old one). */
function compare(label: string): void {
  for (let dy = 0; dy < CHUNK; dy++)
    for (let dx = 0; dx < 2 * CHUNK; dx++) {
      const x = X0 + dx,
        y = Y0 + dy,
        c = map.get(x, y)!,
        r = ref.get(x, y);
      if ((c & 0xffff) !== (r & 0xffff)) {
        check(false, `${label}: tile ${x},${y} client ${c & LOMASK} (${(c & 0xffff).toString(16)}) server ${r & LOMASK} (${(r & 0xffff).toString(16)})`);
        return;
      }
    }
}
/** The server's answer: its changed tiles, then the ack. */
function serverAnswers(seq: number, ok: boolean): void {
  const u: number[] = [];
  for (const i of ref.changed) {
    const x = i % WORLD_W;
    u.push(x, (i - x) / WORLD_W, ref.get(x, (i - x) / WORLD_W));
  }
  ref.changed.clear();
  map.applyTiles(u);
  predictor.ack(seq, ok);
}

// a stroke of builds, each predicted on top of the one before (no answers yet), then all answered
const stroke: [ToolId, number, number][] = [];
for (let dx = 2; dx < 30; dx++) stroke.push(['rail', X0 + dx, Y0 + 10]); // rail east-west
for (let dy = 2; dy < 30; dy++) stroke.push(['road', X0 + 15, Y0 + dy]); // road north-south, crossing the rail
for (let dx = 2; dx < 30; dx++) stroke.push(['wire', X0 + dx, Y0 + 20]); // wire east-west, crossing the road
for (let dy = 35; dy < 50; dy++) stroke.push(['road', X0 + 5, Y0 + dy]); // road over the river: a bridge
stroke.push(['residential', X0 + 22, Y0 + 20]); // a zone over the wire
stroke.push(['university', X0 + 40, Y0 + 5]);
stroke.push(['park', X0 + 50, Y0 + 30], ['park', X0 + 51, Y0 + 30]);
stroke.push(['road', X0 + 70, Y0 + 5]); // unowned: refused on both sides
stroke.push(['road', X0 + 15, Y0 + 12]); // already a road: refused
const seqs: { seq: number; ok: boolean }[] = [];
for (const [tool, x, y] of stroke) {
  const seq = predictor.next();
  const predicted = predictor.predict(seq, tool, x, y);
  const r = applyBuildRules(ref, refPlayer, tool, x, y, {}, refRng);
  if (r.ok) funds -= r.cost;
  check(
    (predicted !== null) === r.ok,
    `${tool} at ${x},${y}: client ${predicted !== null ? 'predicted' : 'refused'}, server ${r.ok ? 'built' : `refused (${r.ok ? '' : r.msg})`}`,
  );
  seqs.push({ seq, ok: r.ok });
  compare(`after ${tool} at ${x},${y}`);
}
// road pieces connected while painting: the road crossing the rail is a crossing, its neighbours straight
check((map.get(X0 + 15, Y0 + 10)! & LOMASK) === (ref.get(X0 + 15, Y0 + 10) & LOMASK), 'rail/road crossing');
// looks kept on predicted tiles
const t = map.get(X0 + 3, Y0 + 10)!;
check((t & LOOK_BITS) === lookAtPlace(X0 + 3, Y0 + 10), 'predicted tile keeps the look of the tile it replaced');
// the university shows before the server says so
check([...customs.ofKind('university')].length === 1, 'predicted university is shown');
check(map.predictedCount > 0, 'tiles are predicted');

// the server's tiles arrive while predicted: the prediction still shows until the ack, then the real tiles
stats.funds = funds;
for (const { seq, ok } of seqs) serverAnswers(seq, ok);
check(map.predictedCount === 0, `all predictions settled (${map.predictedCount} left)`);
check(predictor.waiting === 0, 'no builds waiting');
for (let dy = 0; dy < CHUNK; dy++)
  for (let dx = 0; dx < CHUNK; dx++) {
    const x = X0 + dx,
      y = Y0 + dy;
    if (map.get(x, y) !== ref.get(x, y)) {
      check(false, `settled tile ${x},${y} differs from the server`);
      break;
    }
  }
check([...customs.ofKind('university')].length === 0, "the predicted university goes once settled (the server's building message brings the real one)");
customs.apply('add', { kind: 'university', x: X0 + 39, y: Y0 + 4 });

// bulldozing: a road piece, the zone, the university
const later: [ToolId, number, number][] = [
  ['bulldozer', X0 + 15, Y0 + 5],
  ['bulldozer', X0 + 22, Y0 + 21],
  ['bulldozer', X0 + 41, Y0 + 6],
];
for (const [tool, x, y] of later) {
  const seq = predictor.next();
  const predicted = predictor.predict(seq, tool, x, y);
  const r = applyBuildRules(ref, refPlayer, tool, x, y, {}, refRng);
  if (r.ok) funds -= r.cost;
  check((predicted !== null) === r.ok, `${tool} at ${x},${y}: client ${predicted !== null}, server ${r.ok}`);
  compare(`after ${tool} at ${x},${y}`);
  if (tool === 'bulldozer' && x === X0 + 41) check([...customs.ofKind('university')].length === 0, 'bulldozed university hidden at once');
  stats.funds = funds;
  serverAnswers(seq, r.ok);
}
const centre = ref.get(X0 + 40, Y0 + 5);
check(!(centre & ZONEBIT && (centre & LOMASK) === CUSTOMCENTRE), 'university gone on the server');

// a refused prediction (the server disagrees): shown, then gone after the not-ok ack
{
  const seq = predictor.next();
  check(predictor.predict(seq, 'road', X0 + 60, Y0 + 60) !== null, 'road predicted');
  check((map.get(X0 + 60, Y0 + 60)! & LOMASK) !== DIRT, 'predicted road shows');
  predictor.ack(seq, false);
  check(map.get(X0 + 60, Y0 + 60) === ref.get(X0 + 60, Y0 + 60), 'refused road is gone');
  check(predictor.refused === 1, 'refusal counted');
}
// not enough funds: no prediction
{
  const saved = stats.funds;
  stats.funds = 5;
  const seq = predictor.next();
  check(predictor.predict(seq, 'road', X0 + 61, Y0 + 61) === null, 'no prediction without funds');
  check(map.predictedCount === 0, 'nothing shown without funds');
  predictor.ack(seq, false);
  stats.funds = saved;
}
// in-flight costs count against funds: two $10 roads with $15
{
  const saved = stats.funds;
  stats.funds = 15;
  const a = predictor.next(),
    b = predictor.next();
  check(predictor.predict(a, 'road', X0 + 61, Y0 + 61) !== null, 'first road predicted');
  check(predictor.predict(b, 'road', X0 + 62, Y0 + 61) === null, 'second road not predicted: the first one spends the money');
  predictor.clear();
  stats.funds = saved;
}
// no answer: dropped after the timeout
{
  const seq = predictor.next();
  predictor.predict(seq, 'road', X0 + 60, Y0 + 62);
  clock += PREDICTION_TIMEOUT_MS - 100;
  predictor.expire();
  check(map.predictedCount > 0, 'still predicted before the timeout');
  clock += 200;
  predictor.expire();
  check(map.predictedCount === 0 && predictor.waiting === 0, 'dropped after the timeout');
}
// reconnect clears everything
{
  predictor.predict(predictor.next(), 'road', X0 + 60, Y0 + 63);
  predictor.predict(predictor.next(), 'university', X0 + 40, Y0 + 50);
  predictor.clear();
  check(map.predictedCount === 0 && [...customs.ofKind('university')].length === 1, 'clear drops tiles and buildings');
}
// a chunk reloaded under a prediction keeps showing it
{
  const seq = predictor.next();
  predictor.predict(seq, 'road', X0 + 60, Y0 + 63);
  const shown = map.get(X0 + 60, Y0 + 63);
  const a = new Uint32Array(map.getChunk(CX, CY)!);
  a[63 * CHUNK + 60] = ref.get(X0 + 60, Y0 + 63);
  map.setChunk(CX, CY, a);
  check(map.get(X0 + 60, Y0 + 63) === shown, 'prediction survives a chunk reload');
  predictor.ack(seq, false);
  check(map.get(X0 + 60, Y0 + 63) === ref.get(X0 + 60, Y0 + 63), 'and settles to the reloaded tile');
}

console.log(failures ? `${failures} failed` : `PASS (${stroke.length + later.length} builds compared)`);
process.exit(failures ? 1 : 0);
