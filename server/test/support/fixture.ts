// The fixture world the gameplay tests play on: 1024 x 512 tiles (16 x 8 plots), built in code from the scenario
// below in a few milliseconds, in the same format the world generator writes (docs/world-format.md). Tests ask for
// a named site (`site('coast')`), never for real places or chunk numbers, so the generated Earth can change freely.
//
//   cx  0    1    2 .. 9            10   11 .. 14          15
//   cy0 frozen sea (ice) ...........................................
//   cy1 sea  sea  snow (glacier) .  sea  sea .........      sea
//   cy2 sea  sea  coast | forest    sea  far coast | east   sea
//   ..             |  inland         (channel)      continent
//   cy5 sea  isl.  |  desert, river
//   cy6 sea  sea   |  .. desert
//   cy7 open sea all the way round (the west and east seas meet at the date line)
//
// The main continent spans plots 2..9 x 1..6. Its west coast runs down plot column 2 (24 tiles of sea, then a strip of
// low land that floods); inland it is flat dry dirt (one small grove where the first city goes, so a bulldozer has
// trees to clear). A lake in plot 8,4 drains south through the desert in a river to the sea. The east continent
// (plots 11..14 x 2..6) faces it across a channel, so ships and planes have somewhere far to go.
import fs from 'node:fs';
import path from 'node:path';
import { BASE_FROZEN, BASE_TREES, BASE_WATER, Biome, CHUNK, Disaster, hazardBit } from '@globalcity/shared';

export const FIXTURE_W = 1024,
  FIXTURE_H = 512;
const CX = FIXTURE_W / CHUNK,
  CY = FIXTURE_H / CHUNK;

/** A rectangle of tiles, [x0, y0, x1, y1) */
type Rect = [number, number, number, number];
/** Painted over what is there, in order; a field left out keeps the tile's value. */
interface Paint {
  what: string;
  rect: Rect;
  water?: boolean;
  frozen?: boolean;
  biome?: Biome;
  trees?: boolean;
  elev?: number;
}
const P = (cx: number, cy: number): [number, number] => [cx * CHUNK, cy * CHUNK];
/** Whole plots cx0..cx1 x cy0..cy1 (inclusive) as a tile rectangle. */
const plots = (cx0: number, cy0: number, cx1: number, cy1: number): Rect => [cx0 * CHUNK, cy0 * CHUNK, (cx1 + 1) * CHUNK, (cy1 + 1) * CHUNK];

const WEST_COAST = 2 * CHUNK + 24; // the main continent's west shore: plot column 2 has 24 columns of sea, 40 of land
const FAR_COAST = 11 * CHUNK + 20; // the east continent's west shore

const PAINT: Paint[] = [
  { what: 'open sea', rect: [0, 0, FIXTURE_W, FIXTURE_H], water: true, frozen: false, biome: Biome.Temperate, trees: false, elev: -80 },
  { what: 'frozen sea', rect: plots(0, 0, CX - 1, 0), frozen: true, biome: Biome.Snow, elev: -40 },
  { what: 'main continent', rect: [WEST_COAST, CHUNK, 10 * CHUNK, 7 * CHUNK], water: false, elev: 60 },
  { what: 'glacier', rect: [WEST_COAST, CHUNK, 10 * CHUNK, 2 * CHUNK], biome: Biome.Snow, elev: 400 },
  { what: 'low coast', rect: [WEST_COAST, 2 * CHUNK, WEST_COAST + 16, 7 * CHUNK], elev: 2 },
  { what: 'forest', rect: plots(6, 2, 7, 2), trees: true, elev: 120 },
  { what: 'grove', rect: [P(4, 4)[0] + 3, P(4, 4)[1] + 2, P(4, 4)[0] + 9, P(4, 4)[1] + 5], trees: true },
  { what: 'desert', rect: plots(6, 5, 9, 6), biome: Biome.Desert, elev: 150 },
  { what: 'lake', rect: [P(8, 4)[0] + 16, P(8, 4)[1] + 16, P(8, 4)[0] + 48, P(8, 4)[1] + 40], water: true, elev: 45 },
  { what: 'river', rect: [P(8, 4)[0] + 30, P(8, 4)[1] + 40, P(8, 4)[0] + 34, 7 * CHUNK], water: true, elev: 30 },
  { what: 'island', rect: [P(1, 5)[0] + 30, P(1, 5)[1] + 20, P(1, 5)[0] + 48, P(1, 5)[1] + 40], water: false, biome: Biome.Temperate, elev: 8 },
  { what: 'east continent', rect: [FAR_COAST, 2 * CHUNK, 15 * CHUNK, 7 * CHUNK], water: false, elev: 80 },
  { what: 'boreal woods', rect: plots(12, 2, 14, 2), biome: Biome.Boreal, trees: true, elev: 200 },
  { what: 'steppe', rect: plots(13, 5, 14, 6), biome: Biome.Steppe, elev: 300 },
];

/** Which disasters can strike where (whole plots, inclusive). */
const HAZARDS: { kind: Disaster; plots: [number, number, number, number] }[] = [
  { kind: Disaster.Earthquake, plots: [8, 2, 9, 3] },
  { kind: Disaster.Flood, plots: [2, 2, 2, 6] },
  { kind: Disaster.Flood, plots: [8, 4, 8, 6] },
  { kind: Disaster.Tornado, plots: [3, 5, 5, 6] },
  { kind: Disaster.Storm, plots: [11, 3, 11, 6] },
  { kind: Disaster.Wildfire, plots: [6, 2, 7, 2] },
  { kind: Disaster.Blizzard, plots: [2, 1, 9, 1] },
];

/** Populated places, for city names: [name, x, y, population, country]. */
const PLACES: [string, number, number, number, string][] = [
  ['Middleton', 4 * CHUNK + 32, 4 * CHUNK + 32, 500_000, 'Fixtureland'],
  ['Farport', FAR_COAST + 12, 3 * CHUNK + 32, 300_000, 'Eastland'],
  ['Eastbrook', 13 * CHUNK + 32, 4 * CHUNK + 32, 200_000, 'Eastland'],
  ['Seaview', WEST_COAST + 8, 3 * CHUNK + 32, 120_000, 'Fixtureland'],
  ['Lakeside', 8 * CHUNK + 10, 4 * CHUNK + 30, 80_000, 'Fixtureland'],
  ['Southgate', 4 * CHUNK + 32, 6 * CHUNK + 32, 70_000, 'Fixtureland'],
  ['Northfield', 4 * CHUNK + 32, 2 * CHUNK + 32, 60_000, 'Fixtureland'],
  ['Dunehaven', 6 * CHUNK + 32, 5 * CHUNK + 32, 40_000, 'Fixtureland'],
  ['Frostholm', 5 * CHUNK + 32, 1 * CHUNK + 32, 5_000, 'Fixtureland'],
];

/** What the tests can ask for. Every site is a plot (chunk); `about` says what is there. */
export const SITES = {
  inland: { cx: 4, cy: 4, about: 'flat dry temperate land, plenty of free plots all around (a small grove near its top-left corner)' },
  east: { cx: 13, cy: 4, about: 'the middle of the east continent, far from inland' },
  coast: { cx: 2, cy: 3, about: 'the west coast: 24 columns of open sea, then 16 of low land (2 m, floods), then dry land; plot 3,3 east of it is land' },
  farCoast: { cx: 11, cy: 3, about: 'the east continent facing the coast across the sea (20 columns of sea); storms strike here' },
  sea: { cx: 0, cy: 3, about: 'open sea, no land' },
  lake: { cx: 8, cy: 4, about: 'a 32 x 24 lake in dry land' },
  river: { cx: 8, cy: 5, about: 'a 4-wide river running south through the desert to the sea' },
  forest: { cx: 6, cy: 2, about: 'all woods (wildfires)' },
  frozen: { cx: 5, cy: 0, about: 'frozen sea' },
  snow: { cx: 5, cy: 1, about: 'glacier: snow biome land (blizzards)' },
  desert: { cx: 6, cy: 5, about: 'sand: desert biome land' },
  island: {
    cx: 1,
    cy: 5,
    about: 'sea with an 18 x 20 island (360 land tiles: an extra plot, too small for a first one); plot 2,5 east of it has plenty of land',
  },
  quake: { cx: 9, cy: 2, about: 'earthquake country' },
  tornado: { cx: 4, cy: 6, about: 'tornado alley' },
} as const satisfies Record<string, { cx: number; cy: number; about: string }>;
export type SiteName = keyof typeof SITES;

/** A named site's plot. */
export function site(name: SiteName): { cx: number; cy: number } {
  const s = SITES[name];
  return { cx: s.cx, cy: s.cy };
}
/** A named site's plot as a [cx, cy] pair (for settle() and other candidate lists). */
export const at = (name: SiteName): [number, number] => [SITES[name].cx, SITES[name].cy];

export interface FixtureWorld {
  w: number;
  h: number;
  /** a byte per tile (shared/src/terrain.ts) */
  base: Uint8Array;
  /** metres per tile */
  elevation: Int16Array;
  /** a byte per chunk of hazardBit()s */
  hazards: Uint8Array;
  places: [string, number, number, number, string][];
}

/** Build the fixture world (a few ms). */
export function buildFixture(): FixtureWorld {
  const W = FIXTURE_W,
    H = FIXTURE_H;
  const base = new Uint8Array(W * H),
    elevation = new Int16Array(W * H);
  for (const p of PAINT) {
    const [x0, y0, x1, y1] = p.rect;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = y * W + x;
        let b = base[i];
        if (p.biome !== undefined) b = (b & ~0x0f) | p.biome;
        if (p.water !== undefined) b = p.water ? b | BASE_WATER : b & ~(BASE_WATER | BASE_FROZEN);
        if (p.trees !== undefined) b = p.trees ? b | BASE_TREES : b & ~BASE_TREES;
        if (p.frozen !== undefined) b = p.frozen ? b | BASE_FROZEN : b & ~BASE_FROZEN;
        if (!(b & BASE_WATER)) b &= ~BASE_FROZEN; // only water freezes
        else b &= ~BASE_TREES; // and no trees grow in it
        base[i] = b;
        if (p.elev !== undefined) elevation[i] = p.elev;
      }
  }
  const hazards = new Uint8Array(CX * CY);
  for (const h of HAZARDS) {
    const [cx0, cy0, cx1, cy1] = h.plots;
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) hazards[cy * CX + cx] |= hazardBit(h.kind);
  }
  return { w: W, h: H, base, elevation, hazards, places: [...PLACES].sort((a, b) => b[3] - a[3]) };
}

/** Land tiles of each chunk, row-major (as the server counts them: what isn't water). */
export function landPerChunk(f: FixtureWorld): Int32Array {
  const out = new Int32Array(CX * CY);
  for (let y = 0; y < f.h; y++)
    for (let x = 0; x < f.w; x++) if (!(f.base[y * f.w + x] & BASE_WATER)) out[Math.floor(y / CHUNK) * CX + Math.floor(x / CHUNK)]++;
  return out;
}

/** Write the fixture world into `dir` as a world directory the server can play on (WORLD_DIR). */
export function writeFixture(dir: string, f = buildFixture()): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'base.bin'), f.base);
  fs.writeFileSync(path.join(dir, 'elevation.bin'), new Uint8Array(f.elevation.buffer, f.elevation.byteOffset, f.elevation.byteLength));
  fs.writeFileSync(path.join(dir, 'hazards.bin'), f.hazards);
  fs.writeFileSync(path.join(dir, 'places.json'), JSON.stringify({ generatedAt: 'fixture', source: 'server/test/support/fixture.ts', places: f.places }));
  fs.writeFileSync(
    path.join(dir, 'base.json'),
    JSON.stringify(
      {
        w: f.w,
        h: f.h,
        version: 2,
        generatedAt: 'fixture',
        about: 'the gameplay tests fixture world (server/test/support/fixture.ts)',
        sites: SITES,
      },
      null,
      2,
    ),
  );
}
