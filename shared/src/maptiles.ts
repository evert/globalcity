// The zoomed-out map as a pyramid of small images ("map tiles"), rendered by the server and fetched by the
// client only for what is on screen. Level L draws one pixel per 2^L x 2^L world tiles; every level is cut into
// MAP_REGION x MAP_REGION pixel images, so the whole world at the top level is a single image (256 x 128 for the Earth).
// Images are 8-bit indexed PNGs: one palette (below) shared by server and client, so a mostly-terrain region
// is a few kilobytes. Every region has a version; the URL carries it, so an unchanged region is served once and
// then comes from the browser's (or the CDN's) cache. The server publishes the versions of the level-0 regions
// in /map/manifest; a region at a higher level has the sum of the versions of the level-0 regions it covers.
//
//   GET /map/manifest                      { w, v: number[], lit: number[] } (see MapManifest)
//   GET /map/day/<L>/<rx>/<ry>.png?v=<n>   the map: terrain and what is built
//   GET /map/lights/<L>/<rx>/<ry>.png?v=<n> night lights (transparent where dark), only for regions in `lit`
import { WORLD_W, WORLD_H, CHUNK } from './constants.ts';
import { Biome, BIOME_COUNT, BASE_WATER, baseBiome, baseIsFrozen } from './terrain.ts';
import { OvClass, OV_DARK, OV_CLASS_MASK, overviewClass, overviewByte, OVERVIEW_PALETTE } from './overview.ts';
import { biomeMapColours, ICE_RGB, ICE_SPECK_RGB } from './biomeart.ts';
import { LOMASK } from './tiles.ts';

export const MAP_REGION = 256;
/** Levels 0..mapLevels()-1; the top one shows the whole world in one image. (Functions, not constants: they follow
 *  the world's size, configureWorld.) */
export const mapLevels = (): number => Math.max(0, Math.ceil(Math.log2(Math.max(WORLD_W, WORLD_H) / MAP_REGION))) + 1;
/** Level-0 regions across and down. */
export const mapL0Cols = (): number => Math.ceil(WORLD_W / MAP_REGION);
export const mapL0Rows = (): number => Math.ceil(WORLD_H / MAP_REGION);

/** Regions across and down at a level. */
export function mapRegionGrid(level: number): { cols: number; rows: number } {
  const span = MAP_REGION << level;
  return { cols: Math.ceil(WORLD_W / span), rows: Math.ceil(WORLD_H / span) };
}
/** Pixel size of one region image (the last row/column of a level may be smaller). */
export function mapRegionSize(level: number, rx: number, ry: number): { w: number; h: number } {
  const lw = WORLD_W >> level,
    lh = WORLD_H >> level;
  return { w: Math.min(MAP_REGION, lw - rx * MAP_REGION), h: Math.min(MAP_REGION, lh - ry * MAP_REGION) };
}

export interface MapManifest {
  /** identifies the generated world (base.bin): images of untouched regions are valid as long as it is the same */
  w: string;
  /** version per level-0 region, row-major mapL0Cols() x mapL0Rows(); 0 = untouched landscape */
  v: number[];
  /** level-0 regions (indices) that have anything built: the only ones with night lights */
  lit: number[];
}

/** Version of region (rx, ry) at `level`: the sum of the level-0 versions it covers (u32). */
export function mapRegionVersion(v: ArrayLike<number>, level: number, rx: number, ry: number): number {
  const n = 1 << level;
  let s = 0;
  const cols = mapL0Cols(),
    rows = mapL0Rows();
  for (let y = ry * n; y < Math.min(rows, (ry + 1) * n); y++) for (let x = rx * n; x < Math.min(cols, (rx + 1) * n); x++) s = (s + v[y * cols + x]) >>> 0;
  return s;
}

// ---- day palette ----
// 0..15: the overview classes (buildings, roads, ...; the Dirt/Water/Trees entries are replaced by terrain below)
// 16 + biome*4 + 0 ground, +1 ground speck, +2 trees, +3 trees speck
// MAP_WATER (+1 speck), MAP_ICE (+1 speck)
export const MAP_TERRAIN_BASE = 16;
export const MAP_WATER = MAP_TERRAIN_BASE + BIOME_COUNT * 4;
export const MAP_ICE = MAP_WATER + 2;
export const MAP_PALETTE_SIZE = MAP_ICE + 2;
export const MAP_PALETTE: readonly (readonly [number, number, number])[] = (() => {
  const p: [number, number, number][] = OVERVIEW_PALETTE.map((c) => [c[0], c[1], c[2]]);
  for (let b = 0; b < BIOME_COUNT; b++) {
    const c = biomeMapColours(b as Biome);
    const darker = (x: readonly [number, number, number]): [number, number, number] => [(x[0] * 0.75) | 0, (x[1] * 0.75) | 0, (x[2] * 0.75) | 0];
    p.push([...c.ground], [...c.speck], [...c.trees], darker(c.trees));
  }
  p.push([0x66, 0x66, 0xe6], [0x33, 0x33, 0xc8], [...ICE_RGB], [...ICE_SPECK_RGB]);
  return p;
})();

/** Is this palette index a speck variant (of terrain)? Specks are a per-pixel texture, not data. */
export const mapIsSpeck = (i: number): boolean => i >= MAP_TERRAIN_BASE && ((i - MAP_TERRAIN_BASE) & 1) === 1;
/** Deterministic speck pattern: roughly one pixel in nine is darker. */
export const mapSpeckAt = (x: number, y: number): boolean => (((x * 73856093) ^ (y * 19349663)) >>> 0) % 9 === 0;

/** Tile id -> overview class, as a lookup table (the class depends only on the id). */
export const MAP_CLASS_OF_ID: Uint8Array = (() => {
  const t = new Uint8Array(LOMASK + 1);
  for (let id = 0; id <= LOMASK; id++) t[id] = overviewClass(id);
  return t;
})();

/** Day palette index (without speck) for a tile value and its terrain byte. */
export function mapIndex(v: number, terrain: number): number {
  const c = MAP_CLASS_OF_ID[v & LOMASK];
  if (c === OvClass.Dirt) return MAP_TERRAIN_BASE + baseBiome(terrain) * 4;
  if (c === OvClass.Trees) return MAP_TERRAIN_BASE + baseBiome(terrain) * 4 + 2;
  if (c === OvClass.Water) return terrain & BASE_WATER && baseIsFrozen(terrain) ? MAP_ICE : MAP_WATER;
  return c;
}

/** How much a palette index should win when 2x2 pixels become one: buildings over roads over landscape. */
export const MAP_WEIGHT: Uint8Array = (() => {
  const w = new Uint8Array(MAP_PALETTE_SIZE).fill(1);
  for (const c of [OvClass.Res, OvClass.Com, OvClass.Ind, OvClass.Civic, OvClass.Power, OvClass.Special, OvClass.Fire]) w[c] = 4;
  for (const c of [OvClass.Road, OvClass.Traffic, OvClass.Rail, OvClass.Wire, OvClass.Park, OvClass.Rubble]) w[c] = 2;
  return w;
})();

/** One pixel from four (palette indices without speck), weighted by MAP_WEIGHT; ties go to the first. */
export function mapPick4(a: number, b: number, c: number, d: number): number {
  const W = MAP_WEIGHT;
  const sa = W[a] * (1 + +(b === a) + +(c === a) + +(d === a));
  const sb = b === a ? 0 : W[b] * (1 + +(c === b) + +(d === b));
  const sc = c === a || c === b ? 0 : W[c] * (1 + +(d === c));
  const sd = d === a || d === b || d === c ? 0 : W[d];
  let best = a,
    bs = sa;
  if (sb > bs) {
    best = b;
    bs = sb;
  }
  if (sc > bs) {
    best = c;
    bs = sc;
  }
  if (sd > bs) best = d;
  return best;
}

// ---- night lights palette ----
// 0 transparent; 1.. one entry per lit class (level 0, a lit tile); MAP_GLOW_BASE + k: a warm glow of
// increasing strength (higher levels, by the share of lit tiles under the pixel)
export const MAP_LIGHTS: Partial<Record<OvClass, { rgb: [number, number, number]; share: number; alpha: number }>> = {
  [OvClass.Res]: { rgb: [255, 200, 120], share: 0.25, alpha: 170 },
  [OvClass.Com]: { rgb: [255, 225, 170], share: 0.35, alpha: 180 },
  [OvClass.Ind]: { rgb: [255, 165, 85], share: 0.2, alpha: 160 },
  [OvClass.Civic]: { rgb: [255, 220, 160], share: 0.3, alpha: 170 },
  [OvClass.Special]: { rgb: [255, 215, 140], share: 0.3, alpha: 170 },
  [OvClass.Power]: { rgb: [255, 150, 70], share: 0.15, alpha: 150 },
  [OvClass.Road]: { rgb: [255, 190, 110], share: 0.08, alpha: 110 },
  [OvClass.Traffic]: { rgb: [255, 205, 140], share: 0.2, alpha: 140 },
  [OvClass.Fire]: { rgb: [255, 120, 40], share: 1, alpha: 255 },
};
/** Deterministic pattern of which tiles of a class are lit. */
export const mapLitAt = (x: number, y: number, share: number): boolean => (((x * 2654435761) ^ (y * 2246822519)) >>> 0) % 1000 < share * 1000;
export const MAP_GLOW_BASE = 32,
  MAP_GLOW_STEPS = 16;
export const MAP_LIGHTS_PALETTE: readonly (readonly [number, number, number, number])[] = (() => {
  const p: [number, number, number, number][] = Array.from({ length: MAP_GLOW_BASE + MAP_GLOW_STEPS }, () => [0, 0, 0, 0]);
  for (const [c, L] of Object.entries(MAP_LIGHTS)) if (L) p[1 + Number(c)] = [...L.rgb, L.alpha];
  // a soft glow: even the brightest city stays see-through, like Earth at night from orbit
  for (let k = 0; k < MAP_GLOW_STEPS; k++) p[MAP_GLOW_BASE + k] = [255, 200, 120, Math.round(24 + (146 * (k + 1)) / MAP_GLOW_STEPS)];
  return p;
})();
/** Lights palette index of one tile at level 0, or 0 when dark (no power, empty zone, unlit spot). */
export function mapLightIndex(v: number, x: number, y: number): number {
  const ob = overviewByte(v);
  if (ob & OV_DARK) return 0;
  const c = (ob & OV_CLASS_MASK) as OvClass;
  const L = MAP_LIGHTS[c];
  return L && mapLitAt(x, y, L.share) ? 1 + c : 0;
}

/** Chunks per level-0 region side. */
export const MAP_CHUNKS_PER_REGION = MAP_REGION / CHUNK;
