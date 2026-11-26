// Tile looks: how a tile is drawn, as opposed to what it is.
//
// A tile value is 32 bits. The low 16 are Micropolis' own: the tile kind (bits 0-9, LOMASK) and its flags
// (bits 10-15: ZONEBIT ... PWRBIT). Everything the game does depends on those. Bits 16-24 are the look:
// which biome's art the tile is drawn with, whether its water is frozen, or a transition between two
// biomes (or between ice and open water) at a border. The look follows from where the tile is and what kind
// it is (see lookAt), so the server stamps it whenever it writes a tile and nothing else ever sets it.
//
// The art for every look is baked into one sheet (client/public/assets/micropolis/skins.png, built by
// `npm run gen:sheet -w tools`): every tile in every biome, the water tiles frozen, and the transition tiles.
// sheetIndex(tile) says where a tile's picture is.
import { WORLD_W, WORLD_H } from './constants.ts';
import * as T from './tiles.ts';
import { Biome, BIOME_COUNT, BASE_BIOME_MASK, BASE_WATER, BASE_FROZEN } from './terrain.ts';
import { onWaterId } from './biomeart.ts';

export const LOOK_SHIFT = 16;
export const LOOK_BITS = 0x1ff << LOOK_SHIFT;
/** The look of a tile value. */
export const lookOf = (v: number): number => (v >>> LOOK_SHIFT) & 0x1ff;
/** A tile value without its look (kind + flags): what tools and the simulation work with. */
export const withoutLook = (v: number): number => v & 0xffff;

// ---- looks ----
// 0..11: plain skins, biome * 2 + frozen
// GROUND_LOOKS: biome A's tile with some corners in biome B (A above B in BIOME_PRECEDENCE)
// ICE_LOOKS: a frozen water tile with some corners open
export const SKIN_COUNT = BIOME_COUNT * 2;
export const skinLook = (biome: Biome, frozen: boolean): number => biome * 2 + (frozen ? 1 : 0);
/** Which biome's ground wins a border: transitions are drawn inside the tiles of the higher one. */
export const BIOME_PRECEDENCE: readonly Biome[] = [Biome.Snow, Biome.Boreal, Biome.Tundra, Biome.Temperate, Biome.Steppe, Biome.Desert];
const RANK: number[] = []; BIOME_PRECEDENCE.forEach((b, i) => { RANK[b] = i; });
/** Ordered pairs (higher, lower) of biomes that can share a border. */
export const GROUND_PAIRS: readonly [Biome, Biome][] = (() => {
  const out: [Biome, Biome][] = [];
  for (let i = 0; i < BIOME_PRECEDENCE.length; i++) for (let j = i + 1; j < BIOME_PRECEDENCE.length; j++) out.push([BIOME_PRECEDENCE[i], BIOME_PRECEDENCE[j]]);
  return out;
})();
const PAIR_INDEX = new Map(GROUND_PAIRS.map(([a, b], i) => [a * 8 + b, i]));
/** Corner masks of a transition: bit 1 NE, 2 SE, 4 SW, 8 NW set = that corner is in the other biome (1..14). */
export const CORNER_MASKS = 14;
export const GROUND_LOOK_BASE = SKIN_COUNT;
export const ICE_LOOK_BASE = GROUND_LOOK_BASE + GROUND_PAIRS.length * CORNER_MASKS;
export const LOOK_COUNT = ICE_LOOK_BASE + BIOME_COUNT * CORNER_MASKS;
export const groundLook = (a: Biome, b: Biome, mask: number): number => GROUND_LOOK_BASE + PAIR_INDEX.get(a * 8 + b)! * CORNER_MASKS + (mask - 1);
export const iceLook = (biome: Biome, mask: number): number => ICE_LOOK_BASE + biome * CORNER_MASKS + (mask - 1);

export type LookInfo =
  | { kind: 'skin'; biome: Biome; frozen: boolean }
  | { kind: 'ground'; a: Biome; b: Biome; mask: number }
  | { kind: 'ice'; biome: Biome; mask: number };
export function describeLook(look: number): LookInfo {
  if (look < SKIN_COUNT) return { kind: 'skin', biome: (look >> 1) as Biome, frozen: (look & 1) === 1 };
  if (look < ICE_LOOK_BASE) {
    const t = look - GROUND_LOOK_BASE, [a, b] = GROUND_PAIRS[Math.floor(t / CORNER_MASKS)];
    return { kind: 'ground', a, b, mask: (t % CORNER_MASKS) + 1 };
  }
  const t = look - ICE_LOOK_BASE;
  return { kind: 'ice', biome: Math.floor(t / CORNER_MASKS) as Biome, mask: (t % CORNER_MASKS) + 1 };
}

// ---- which kinds get which art ----
/** Kinds that blend at a biome border: bare ground and trees. */
export const GROUND_TRANSITION_KINDS: readonly number[] = [T.DIRT, 1, ...Array.from({ length: T.WOODS_HIGH - T.WOODS_LOW + 1 }, (_, i) => T.WOODS_LOW + i)];
/** Kinds that blend where ice meets open water: water and shore. */
export const ICE_TRANSITION_KINDS: readonly number[] = Array.from({ length: T.WATER_HIGH - T.WATER_LOW + 1 }, (_, i) => T.WATER_LOW + i);
/** Kinds whose water freezes (water, shore, bridges, underwater lines, offshore wind). */
export const FROZEN_KINDS: readonly number[] = Array.from({ length: T.LOMASK + 1 }, (_, i) => i).filter((i) => onWaterId(i));

// ---- the look of a tile at a place ----
const kindTable = (list: readonly number[]): Uint8Array => { const t = new Uint8Array(T.LOMASK + 1); for (const k of list) t[k] = 1; return t; };
const GROUND_OF = kindTable(GROUND_TRANSITION_KINDS), ICE_OF = kindTable(ICE_TRANSITION_KINDS), FROZEN_OF = kindTable(FROZEN_KINDS);
/** The terrain bits that decide a look: two tiles alike in these draw alike. */
const ALIKE = BASE_BIOME_MASK | BASE_WATER | BASE_FROZEN;
const WW = WORLD_W, WH = WORLD_H;
/**
 * Look for a tile of `kind` at (x, y), from the generated landscape (`base`, see terrain.ts). Borders are
 * Wang-style: each corner of a tile takes the lowest-precedence biome of the four tiles that meet there, so
 * the higher biome's border tiles fray into the lower one. Ice works the same way against open water.
 */
export function lookAt(base: Uint8Array, x: number, y: number, kind: number): number {
  const i = y * WW + x, own = base[i], biome = own & BASE_BIOME_MASK;
  // only bare ground, trees and water blend at borders; everything else just takes its place's skin
  const ice = ICE_OF[kind] === 1 && (own & BASE_FROZEN) !== 0;
  if (!ice && GROUND_OF[kind] === 0) return biome * 2 + (FROZEN_OF[kind] === 1 && (own & BASE_FROZEN) !== 0 ? 1 : 0);
  // nearly every tile is surrounded by more of the same: its plain skin
  if (x > 0 && y > 0 && x < WW - 1 && y < WH - 1) {
    const k = own & ALIKE, a = i - WW, c = i + WW;
    if ((base[a - 1] & ALIKE) === k && (base[a] & ALIKE) === k && (base[a + 1] & ALIKE) === k && (base[i - 1] & ALIKE) === k
      && (base[i + 1] & ALIKE) === k && (base[c - 1] & ALIKE) === k && (base[c] & ALIKE) === k && (base[c + 1] & ALIKE) === k) {
      return biome * 2 + (FROZEN_OF[kind] === 1 && (own & BASE_FROZEN) !== 0 ? 1 : 0);
    }
  }
  // the eight neighbours (the world's edge counts as more of the same)
  const W = WW, dl = x > 0 ? -1 : 0, dr = x < W - 1 ? 1 : 0, du = y > 0 ? -W : 0, dd = y < WH - 1 ? W : 0;
  const n = base[i + du], ne = base[i + du + dr], e = base[i + dr], se = base[i + dd + dr];
  const so = base[i + dd], sw = base[i + dd + dl], w = base[i + dl], nw = base[i + du + dl];
  if (ice) {
    // a corner is open water when any water tile that meets there is open (bit 1 NE, 2 SE, 4 SW, 8 NW)
    const mask = (open(n) || open(ne) || open(e) ? 1 : 0) | (open(e) || open(se) || open(so) ? 2 : 0)
      | (open(so) || open(sw) || open(w) ? 4 : 0) | (open(w) || open(nw) || open(n) ? 8 : 0);
    return mask === 0 ? skinLook(biome, true) : mask === 15 ? skinLook(biome, false) : iceLook(biome, mask);
  }
  // each corner takes the lowest-precedence biome among the four tiles meeting there
  const c0 = lowest(biome, n, ne, e), c1 = lowest(biome, e, se, so), c2 = lowest(biome, so, sw, w), c3 = lowest(biome, w, nw, n);
  if (c0 === biome && c1 === biome && c2 === biome && c3 === biome) return skinLook(biome, false);
  // the other biome: the one at most corners (rarely more than one differs)
  let other = -1, best = 0;
  for (const c of [c0, c1, c2, c3]) {
    if (c === biome) continue;
    const k = +(c0 === c) + +(c1 === c) + +(c2 === c) + +(c3 === c);
    if (k > best) { best = k; other = c; }
  }
  const mask = (c0 === other ? 1 : 0) | (c1 === other ? 2 : 0) | (c2 === other ? 4 : 0) | (c3 === other ? 8 : 0);
  return mask === 15 ? skinLook(other as Biome, false) : groundLook(biome, other as Biome, mask);
}
const open = (b: number): boolean => (b & (BASE_WATER | BASE_FROZEN)) === BASE_WATER;
function lowest(biome: Biome, a: number, b: number, c: number): Biome {
  let low = biome;
  const ba = (a & BASE_BIOME_MASK) as Biome, bb = (b & BASE_BIOME_MASK) as Biome, bc = (c & BASE_BIOME_MASK) as Biome;
  if (RANK[ba] > RANK[low]) low = ba;
  if (RANK[bb] > RANK[low]) low = bb;
  if (RANK[bc] > RANK[low]) low = bc;
  return low;
}
/** NE, SE, SW, NW: the x and y steps toward each corner. */
export const CORNER_DIR: readonly [number, number][] = [[1, -1], [1, 1], [-1, 1], [-1, -1]];

// ---- the sheet ----
// [biome 0 block: tiles 0..1023] ... [biome 5 block]
// [frozen: per biome, the FROZEN_KINDS]
// [ground transitions: per look, the GROUND_TRANSITION_KINDS]
// [ice transitions: per look, the ICE_TRANSITION_KINDS]
export const SHEET_COLS = 64;
const KINDS = T.LOMASK + 1;
export const SHEET_FROZEN_BASE = BIOME_COUNT * KINDS;
export const SHEET_GROUND_BASE = SHEET_FROZEN_BASE + BIOME_COUNT * FROZEN_KINDS.length;
export const SHEET_ICE_BASE = SHEET_GROUND_BASE + GROUND_PAIRS.length * CORNER_MASKS * GROUND_TRANSITION_KINDS.length;
export const SHEET_TILES = SHEET_ICE_BASE + BIOME_COUNT * CORNER_MASKS * ICE_TRANSITION_KINDS.length;

/** Sheet position of every (look, kind): built once, LOOK_COUNT x 1024 entries. */
const SHEET_OF: Int32Array = (() => {
  const t = new Int32Array(LOOK_COUNT * KINDS);
  const slot = (list: readonly number[]) => { const m = new Int16Array(KINDS).fill(-1); list.forEach((k, i) => { m[k] = i; }); return m; };
  const frozenSlot = slot(FROZEN_KINDS), groundSlot = slot(GROUND_TRANSITION_KINDS), iceSlot = slot(ICE_TRANSITION_KINDS);
  for (let look = 0; look < LOOK_COUNT; look++) {
    const d = describeLook(look);
    for (let k = 0; k < KINDS; k++) {
      let s: number;
      if (d.kind === 'skin') s = d.frozen && frozenSlot[k] >= 0 ? SHEET_FROZEN_BASE + d.biome * FROZEN_KINDS.length + frozenSlot[k] : d.biome * KINDS + k;
      else if (d.kind === 'ground') s = groundSlot[k] >= 0 ? SHEET_GROUND_BASE + (look - GROUND_LOOK_BASE) * GROUND_TRANSITION_KINDS.length + groundSlot[k] : d.a * KINDS + k;
      else s = iceSlot[k] >= 0 ? SHEET_ICE_BASE + (look - ICE_LOOK_BASE) * ICE_TRANSITION_KINDS.length + iceSlot[k]
        : frozenSlot[k] >= 0 ? SHEET_FROZEN_BASE + d.biome * FROZEN_KINDS.length + frozenSlot[k] : d.biome * KINDS + k;
      t[look * KINDS + k] = s;
    }
  }
  return t;
})();

/** Where tile value `v` (kind + look) is drawn from in the skins sheet. `kind` overrides the tile's own kind
 *  (an animation frame drawn in the tile's look). */
export function sheetIndex(v: number, kind = v & T.LOMASK): number {
  const look = lookOf(v);
  return SHEET_OF[(look < LOOK_COUNT ? look : 0) * KINDS + kind];
}

/** Every (look, kind) the sheet holds, with its position: what the sheet builder draws. */
export function* sheetEntries(): Generator<{ index: number; look: number; kind: number }> {
  const seen = new Uint8Array(SHEET_TILES);
  for (let look = 0; look < LOOK_COUNT; look++) for (let k = 0; k < KINDS; k++) {
    const index = SHEET_OF[look * KINDS + k];
    if (seen[index]) continue;
    seen[index] = 1;
    yield { index, look, kind: k };
  }
}
