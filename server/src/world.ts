// World state: one Uint32Array of tile values for the whole Earth. The low 16 bits are Micropolis' own (bits
// 0-9 the tile kind, 10-15 flags: ZONEBIT, PWRBIT, ...); bits 16-24 are the tile's look (shared/src/looks.ts),
// which set() stamps from the place and the kind, so the rest of the server never deals with it.

import fs from 'node:fs';
import { Buildings } from './buildings.ts';
import {
  WORLD_W,
  WORLD_H,
  CHUNK,
  CHUNKS_X,
  CHUNKS_Y,
  MIN_LAND_TILES_TO_CLAIM,
  RIVER,
  DIRT,
  WOODS,
  BLBNBIT,
  LOMASK,
  WATER_LOW,
  WATER_HIGH,
  WOODS_LOW,
  WOODS_HIGH,
  RIVER_EDGE_TABLE,
  TREE_EDGE_TABLE,
  isRail,
  isZoneTile,
  isHouse,
  BASE_WATER,
  BASE_TREES,
  Biome,
  baseIsFrozen,
  baseIsForest,
  lookAt,
  LOOK_SHIFT,
} from '@globalcity/shared';
import { log, warn, timed } from './util.ts';

/** Chunk index = cy * CHUNKS_X + cx; used as a compact Map/Set key everywhere on the server. */
export type ChunkIndex = number;
export const chunkIndex = (cx: number, cy: number): ChunkIndex => cy * CHUNKS_X + cx;
export const chunkCoords = (ci: ChunkIndex): { cx: number; cy: number } => ({ cx: ci % CHUNKS_X, cy: Math.floor(ci / CHUNKS_X) });
export const validChunk = (cx: number, cy: number): boolean =>
  Number.isInteger(cx) && Number.isInteger(cy) && cx >= 0 && cy >= 0 && cx < CHUNKS_X && cy < CHUNKS_Y;
const zoneLike = (v: number): boolean => isZoneTile(v) || isHouse(v);

export class World {
  readonly tiles = new Uint32Array(WORLD_W * WORLD_H);
  /** The generated landscape (base.bin, see shared/terrain.ts): biome, forest, water, frozen. Never changes. */
  base: Uint8Array = new Uint8Array(WORLD_W * WORLD_H);
  /** custom-building layer (non-square buildings drawn as images) */
  readonly buildings = new Buildings();
  /** Chunks modified since the last save (only ever-edited chunks get a file). */
  readonly dirty = new Set<ChunkIndex>();
  /** Chunks changed since the zoomed-out map (MapTiles) last caught up. */
  readonly mapDirty = new Set<ChunkIndex>();
  /** Tile updates since the last network flush, grouped by chunk as flat [x, y, v, ...]. */
  readonly pending = new Map<ChunkIndex, number[]>();
  /** A tile gained/lost rail or zone-ness since the sim last rebuilt its rail networks (cleared by the sim). */
  railDirty = true;
  /** Chunks overlaid from a save at boot (the sim normalises their traffic tiles once). */
  readonly loaded = new Set<ChunkIndex>();
  /** The untouched landscape of every chunk that has been built on, copied just before its first change
   *  (so rubble can grow back into what was there). Rebuilt each boot from the base map. */
  readonly pristine = new Map<ChunkIndex, Uint32Array>();
  private landCache = new Int32Array(CHUNKS_X * CHUNKS_Y).fill(-1);

  get(x: number, y: number): number {
    return this.tiles[y * WORLD_W + x];
  }

  /** Any rail tile within 3 tiles of (x,y)? (A 3x3 zone touching rail has track within 3 of each of its tiles.) */
  private railAround(x: number, y: number): boolean {
    for (let dy = -3; dy <= 3; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= WORLD_H) continue;
      for (let dx = -3; dx <= 3; dx++) {
        const xx = x + dx;
        if (xx >= 0 && xx < WORLD_W && isRail(this.tiles[yy * WORLD_W + xx])) return true;
      }
    }
    return false;
  }

  /** The value tile `v` (kind + flags) has at (x, y): with the look for that place stamped on. */
  withLook(x: number, y: number, v: number): number {
    return ((v & 0xffff) | (lookAt(this.base, x, y, v & LOMASK) << LOOK_SHIFT)) >>> 0;
  }

  /** Set a tile (its look is stamped here); marks the chunk dirty and queues the change for broadcast. No-op if unchanged. */
  set(x: number, y: number, v: number): void {
    const i = y * WORLD_W + x;
    v = this.withLook(x, y, v);
    const old = this.tiles[i];
    if (old === v) return;
    const cx = Math.floor(x / CHUNK),
      cy = Math.floor(y / CHUNK);
    if (!this.pristine.has(chunkIndex(cx, cy))) this.pristine.set(chunkIndex(cx, cy), this.chunkView(cx, cy));
    this.tiles[i] = v;
    // Rail networks only care about rail tiles and the zones that touch them: a zone/house change only
    // dirties them when there is track next to it (zone growth elsewhere happens every tick).
    if (isRail(old) !== isRail(v) || (zoneLike(old) !== zoneLike(v) && this.railAround(x, y))) this.railDirty = true;
    const ci = chunkIndex(cx, cy);
    this.dirty.add(ci);
    this.mapDirty.add(ci);
    let arr = this.pending.get(ci);
    if (!arr) {
      arr = [];
      this.pending.set(ci, arr);
    }
    arr.push(x, y, v);
    this.landCache[ci] = -1;
  }

  /** Copy of a chunk's tiles, row-major CHUNK*CHUNK, for sending/saving. */
  chunkView(cx: number, cy: number): Uint32Array {
    const out = new Uint32Array(CHUNK * CHUNK);
    const base = cy * CHUNK * WORLD_W + cx * CHUNK;
    for (let dy = 0; dy < CHUNK; dy++) {
      out.set(this.tiles.subarray(base + dy * WORLD_W, base + dy * WORLD_W + CHUNK), dy * CHUNK);
    }
    return out;
  }

  /** Water here is ice for at least half of the year: ships can't cross it and it isn't open water for ports or offshore wind. */
  frozen(x: number, y: number): boolean {
    return baseIsFrozen(this.base[y * WORLD_W + x]);
  }

  /** Overlay saved chunk data without marking dirty or broadcasting (boot only). */
  loadChunk(cx: number, cy: number, data: Uint32Array): void {
    if (!this.pristine.has(chunkIndex(cx, cy))) this.pristine.set(chunkIndex(cx, cy), this.chunkView(cx, cy));
    const base = cy * CHUNK * WORLD_W + cx * CHUNK;
    for (let dy = 0; dy < CHUNK; dy++) {
      this.tiles.set(data.subarray(dy * CHUNK, dy * CHUNK + CHUNK), base + dy * WORLD_W);
    }
    this.stampLooks(cx * CHUNK, cy * CHUNK, CHUNK, CHUNK); // saves made before a look change still draw right
    this.landCache[chunkIndex(cx, cy)] = -1;
    this.loaded.add(chunkIndex(cx, cy));
  }

  /** Stamp the right look on every tile of a rectangle (boot: after building the landscape, and on loaded chunks). */
  stampLooks(x0: number, y0: number, w: number, h: number): void {
    const t = this.tiles;
    for (let y = y0; y < y0 + h; y++)
      for (let x = x0; x < x0 + w; x++) {
        const i = y * WORLD_W + x;
        t[i] = this.withLook(x, y, t[i]);
      }
  }

  /** Number of non-water tiles in a chunk (lazily cached). */
  landCount(cx: number, cy: number): number {
    const ci = chunkIndex(cx, cy);
    let n = this.landCache[ci];
    if (n >= 0) return n;
    n = 0;
    const base = cy * CHUNK * WORLD_W + cx * CHUNK;
    const t = this.tiles;
    for (let dy = 0; dy < CHUNK; dy++) {
      const row = base + dy * WORLD_W;
      for (let dx = 0; dx < CHUNK; dx++) {
        const id = t[row + dx] & LOMASK;
        if (id < WATER_LOW || id > WATER_HIGH) n++;
      }
    }
    this.landCache[ci] = n;
    return n;
  }

  /** Terrain-wise claimable (at least `min` land tiles; see minLandToClaim). Ownership is checked by Players. */
  hasEnoughLand(cx: number, cy: number, min = MIN_LAND_TILES_TO_CLAIM): boolean {
    return this.landCount(cx, cy) >= min;
  }
}

// ---------------------------------------------------------------------------
// Boot: base.bin -> tiles, then Micropolis-style shoreline and tree smoothing.
// ---------------------------------------------------------------------------

export function loadBaseOrFallback(file: string): Uint8Array {
  if (fs.existsSync(file)) {
    const buf = fs.readFileSync(file);
    if (buf.length !== WORLD_W * WORLD_H)
      throw new Error(`${file} has ${buf.length} bytes, expected ${WORLD_W * WORLD_H}: regenerate it with \`npm run gen:world\``);
    log(`Loaded base world ${file} (${(buf.length / 1e6).toFixed(1)} MB)`);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.length);
  } else {
    warn(`${file} not found. Run \`npm run gen:world\` to build the Earth map. Using a tiny deterministic noise world for now.`);
  }
  return timed('Generated fallback noise world', generateFallbackBase);
}

/** Deterministic value-noise world so the server runs standalone without data/world/base.bin. */
export function generateFallbackBase(): Uint8Array {
  const out = new Uint8Array(WORLD_W * WORLD_H);
  const hash = (ix: number, iy: number, seed: number): number => {
    let h = (ix * 374761393 + iy * 668265263 + seed * 1442695041) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  const noise = (x: number, y: number, cell: number, seed: number): number => {
    const gx = x / cell,
      gy = y / cell;
    const ix = Math.floor(gx),
      iy = Math.floor(gy);
    const fx = smooth(gx - ix),
      fy = smooth(gy - iy);
    const a = hash(ix, iy, seed),
      b = hash(ix + 1, iy, seed),
      c = hash(ix, iy + 1, seed),
      d = hash(ix + 1, iy + 1, seed);
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  };
  for (let y = 0; y < WORLD_H; y++) {
    const polar = Math.abs(y / WORLD_H - 0.5) * 2; // 0 equator .. 1 poles
    for (let x = 0; x < WORLD_W; x++) {
      const i = y * WORLD_W + x;
      const n = noise(x, y, 96, 1) * 0.6 + noise(x, y, 24, 2) * 0.3 + noise(x, y, 6, 3) * 0.1;
      const biome = polar > 0.85 ? Biome.Snow : polar > 0.7 ? Biome.Boreal : Biome.Temperate;
      if (n + (polar > 0.9 ? 0.2 : 0) <= 0.52) {
        out[i] = BASE_WATER | biome;
        continue;
      }
      const f = noise(x, y, 20, 4);
      out[i] = biome | (f > 0.58 && biome !== Biome.Snow ? BASE_TREES : 0);
    }
  }
  return out;
}

export function buildFromBase(world: World, base: Uint8Array): void {
  const t = world.tiles;
  const woods = WOODS | BLBNBIT;
  world.base = base;
  for (let i = 0; i < t.length; i++) {
    const b = base[i];
    t[i] = b & BASE_WATER ? RIVER : baseIsForest(b) ? woods : DIRT;
  }
}

/**
 * Shoreline smoothing (Micropolis generate.cpp smoothRiver): every RIVER tile becomes the edge
 * tile from RIVER_EDGE_TABLE indexed by which 4-neighbours are water (N:1 E:2 S:4 W:8).
 * The world boundary counts as water. Odd (x^y) tiles use the +1 variant for variety, as Micropolis does.
 * In-place single pass is safe: outputs are still water tiles, so later neighbour reads stay correct.
 */
export function smoothRivers(world: World): void {
  const t = world.tiles;
  const W = WORLD_W,
    H = WORLD_H;
  const isWaterV = (v: number): boolean => {
    const id = v & LOMASK;
    return id >= WATER_LOW && id <= WATER_HIGH;
  };
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      const i = row + x;
      if ((t[i] & LOMASK) !== RIVER) continue;
      let idx = 0;
      if (y === 0 || isWaterV(t[i - W])) idx |= 1;
      if (x === W - 1 || isWaterV(t[i + 1])) idx |= 2;
      if (y === H - 1 || isWaterV(t[i + W])) idx |= 4;
      if (x === 0 || isWaterV(t[i - 1])) idx |= 8;
      let v = RIVER_EDGE_TABLE[idx];
      if ((v & LOMASK) !== RIVER && (x ^ y) & 1) v += 1;
      t[i] = v;
    }
  }
}

/**
 * Tree smoothing (Micropolis generate.cpp smoothTrees): a tree tile becomes TREE_EDGE_TABLE[neighbour
 * woods mask]; 0 removes the tree (dirt), any other value != WOODS gets -8 on odd (x+y). Trees keep BLBNBIT.
 * In-place like Micropolis (results depend on scan order, which is fine for terrain).
 */
export function smoothTrees(world: World): void {
  const t = world.tiles;
  const W = WORLD_W,
    H = WORLD_H;
  const isTreeV = (v: number): boolean => {
    const id = v & LOMASK;
    return id >= WOODS_LOW && id <= WOODS_HIGH;
  };
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      const i = row + x;
      if (!isTreeV(t[i])) continue;
      let idx = 0;
      if (y > 0 && isTreeV(t[i - W])) idx |= 1;
      if (x < W - 1 && isTreeV(t[i + 1])) idx |= 2;
      if (y < H - 1 && isTreeV(t[i + W])) idx |= 4;
      if (x > 0 && isTreeV(t[i - 1])) idx |= 8;
      let v = TREE_EDGE_TABLE[idx];
      if (v === 0) {
        t[i] = DIRT;
        continue;
      }
      if (v !== WOODS && (x + y) & 1) v -= 8;
      t[i] = v | BLBNBIT;
    }
  }
}

export function bootWorld(baseFile: string): World {
  const world = new World();
  const base = loadBaseOrFallback(baseFile);
  timed('Base -> tiles', () => buildFromBase(world, base));
  timed('Shoreline smoothing', () => smoothRivers(world));
  timed('Tree smoothing', () => smoothTrees(world));
  timed('Looks', () => world.stampLooks(0, 0, WORLD_W, WORLD_H));
  return world;
}
