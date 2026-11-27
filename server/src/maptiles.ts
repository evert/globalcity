// Server side of the zoomed-out map (see shared/src/maptiles.ts): renders region images on request and keeps
// what's needed to do that fast.
//
// Level 0 (a pixel per tile) is cut straight from the world tiles when asked for. Levels 1 and up are kept as
// one palette-index array per level (about 45 MB for all of them), built at boot and updated for the chunks
// that changed every few seconds, so even the whole-world image is just a copy. Night lights only exist where
// something has been built, so they are computed on demand from those chunks alone.
import zlib from 'node:zlib';
import {
  WORLD_W,
  WORLD_H,
  CHUNK,
  CHUNKS_X,
  LOMASK,
  MAP_REGION,
  MAP_LEVELS,
  MAP_L0_COLS,
  MAP_L0_ROWS,
  MAP_PALETTE,
  MAP_LIGHTS_PALETTE,
  MAP_GLOW_BASE,
  MAP_GLOW_STEPS,
  MAP_TERRAIN_BASE,
  MAP_CLASS_OF_ID,
  OvClass,
  mapIndex,
  mapPick4,
  mapIsSpeck,
  mapSpeckAt,
  mapLightIndex,
  mapRegionGrid,
  mapRegionSize,
  mapRegionVersion,
  type MapManifest,
} from '@globalcity/shared';
import { encodeIndexedPng } from './png.ts';
import { chunkCoords, type ChunkIndex, type World } from './world.ts';
import { log } from './util.ts';

const CACHE_MAX_BYTES = 96 * 1024 * 1024;
const regionOfChunk = (ci: ChunkIndex): number => {
  const { cx, cy } = chunkCoords(ci);
  return Math.floor((cy * CHUNK) / MAP_REGION) * MAP_L0_COLS + Math.floor((cx * CHUNK) / MAP_REGION);
};

export class MapTiles {
  /** levels[L] for L >= 1: (WORLD_W >> L) x (WORLD_H >> L) palette indices without speck */
  private readonly levels: Uint8Array[] = [];
  /** version per level-0 region: 0 while it is untouched landscape */
  private readonly versions = new Uint32Array(MAP_L0_COLS * MAP_L0_ROWS);
  private readonly changes = new Uint32Array(MAP_L0_COLS * MAP_L0_ROWS);
  /** chunks ever built on, per level-0 region (the only places with lights, or anything but landscape) */
  private readonly edited = new Map<number, Set<ChunkIndex>>();
  /** versions are made unique per server run, so images cached by clients from an earlier run are never reused */
  private readonly epoch = Math.floor(Date.now() / 1000) >>> 0;
  private readonly cache = new Map<string, { ver: number; png: Buffer }>();
  private cacheBytes = 0;
  private manifestCache: { json: string; gz: Buffer } | null = null;

  constructor(
    private readonly world: World,
    private readonly worldId: string,
  ) {
    const t0 = performance.now();
    for (let L = 1; L < MAP_LEVELS; L++) this.levels[L] = new Uint8Array((WORLD_W >> L) * (WORLD_H >> L));
    this.updateRect(0, 0, WORLD_W, WORLD_H);
    for (const ci of world.pristine.keys()) this.markEdited(ci);
    world.mapDirty.clear();
    log(`map tiles: ${MAP_LEVELS} levels built in ${(performance.now() - t0).toFixed(0)} ms`);
  }

  private markEdited(ci: ChunkIndex): void {
    const r = regionOfChunk(ci);
    let set = this.edited.get(r);
    if (!set) {
      set = new Set();
      this.edited.set(r, set);
    }
    set.add(ci);
    this.versions[r] = (this.epoch + this.changes[r]) >>> 0;
  }

  /** Fold the chunks changed since the last call into the pyramid and bump their regions' versions. */
  refresh(): void {
    const dirty = this.world.mapDirty;
    if (!dirty.size) return;
    for (const ci of dirty) {
      const { cx, cy } = chunkCoords(ci);
      this.updateRect(cx * CHUNK, cy * CHUNK, CHUNK, CHUNK);
      const r = regionOfChunk(ci);
      this.changes[r]++;
      this.markEdited(ci);
    }
    dirty.clear();
    this.manifestCache = null;
  }

  /** Recompute levels 1.. for the world rectangle (tile units, multiples of 2^(MAP_LEVELS-1) or whole chunks). */
  private updateRect(x0: number, y0: number, w: number, h: number): void {
    const t = this.world.tiles,
      b = this.world.base;
    // level 1 from the tiles
    {
      const lv = this.levels[1],
        lw = WORLD_W >> 1;
      for (let py = y0 >> 1; py < (y0 + h) >> 1; py++) {
        const r0 = py * 2 * WORLD_W,
          r1 = r0 + WORLD_W;
        for (let px = x0 >> 1; px < (x0 + w) >> 1; px++) {
          const i0 = r0 + px * 2,
            i1 = r1 + px * 2;
          lv[py * lw + px] = mapPick4(mapIndex(t[i0], b[i0]), mapIndex(t[i0 + 1], b[i0 + 1]), mapIndex(t[i1], b[i1]), mapIndex(t[i1 + 1], b[i1 + 1]));
        }
      }
    }
    // each level from the one below (a rect smaller than a pixel still updates the pixel it lies in)
    for (let L = 2; L < MAP_LEVELS; L++) {
      const src = this.levels[L - 1],
        dst = this.levels[L],
        sw = WORLD_W >> (L - 1),
        dw = WORLD_W >> L;
      const px0 = x0 >> L,
        py0 = y0 >> L,
        px1 = Math.max(px0 + 1, (x0 + w) >> L),
        py1 = Math.max(py0 + 1, (y0 + h) >> L);
      for (let py = py0; py < py1; py++)
        for (let px = px0; px < px1; px++) {
          const s = py * 2 * sw + px * 2;
          dst[py * dw + px] = mapPick4(src[s], src[s + 1], src[s + sw], src[s + sw + 1]);
        }
    }
  }

  manifest(): { json: string; gz: Buffer } {
    if (!this.manifestCache) {
      const m: MapManifest = { w: this.worldId, v: Array.from(this.versions), lit: [...this.edited.keys()].sort((a, b) => a - b) };
      const json = JSON.stringify(m);
      this.manifestCache = { json, gz: zlib.gzipSync(json) };
    }
    return this.manifestCache;
  }

  /** Current version of a region. */
  version(level: number, rx: number, ry: number): number {
    return mapRegionVersion(this.versions, level, rx, ry);
  }

  valid(level: number, rx: number, ry: number): boolean {
    if (!Number.isInteger(level) || level < 0 || level >= MAP_LEVELS) return false;
    const g = mapRegionGrid(level);
    return Number.isInteger(rx) && Number.isInteger(ry) && rx >= 0 && ry >= 0 && rx < g.cols && ry < g.rows;
  }

  /** PNG of the map (`kind` day) or its night lights, current version. */
  image(kind: 'day' | 'lights', level: number, rx: number, ry: number): { png: Buffer; ver: number } {
    const ver = this.version(level, rx, ry);
    const key = `${kind}/${level}/${rx}/${ry}`;
    const hit = this.cache.get(key);
    if (hit && hit.ver === ver) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const png = kind === 'day' ? this.renderDay(level, rx, ry) : this.renderLights(level, rx, ry);
    if (hit) this.cacheBytes -= hit.png.length;
    this.cache.set(key, { ver, png });
    this.cacheBytes += png.length;
    for (const [k, v] of this.cache) {
      if (this.cacheBytes <= CACHE_MAX_BYTES) break;
      this.cache.delete(k);
      this.cacheBytes -= v.png.length;
    }
    return { png, ver };
  }

  private renderDay(level: number, rx: number, ry: number): Buffer {
    const { w, h } = mapRegionSize(level, rx, ry);
    const px = new Uint8Array(w * h);
    const ox = rx * MAP_REGION,
      oy = ry * MAP_REGION;
    if (level === 0) {
      const t = this.world.tiles,
        b = this.world.base;
      for (let y = 0; y < h; y++) {
        const row = (oy + y) * WORLD_W + ox;
        for (let x = 0; x < w; x++) {
          const i = mapIndex(t[row + x], b[row + x]);
          px[y * w + x] = i >= MAP_TERRAIN_BASE && mapSpeckAt(ox + x, oy + y) ? i + 1 : i;
        }
      }
    } else {
      const lv = this.levels[level],
        lw = WORLD_W >> level;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = lv[(oy + y) * lw + ox + x];
          px[y * w + x] = i >= MAP_TERRAIN_BASE && !mapIsSpeck(i) && mapSpeckAt(ox + x + level * 7919, oy + y) ? i + 1 : i;
        }
    }
    return encodeIndexedPng(w, h, px, MAP_PALETTE);
  }

  /** Lights: a lit tile's colour at level 0; above it, a glow as strong as the share of lit tiles under the pixel. */
  private renderLights(level: number, rx: number, ry: number): Buffer {
    const { w, h } = mapRegionSize(level, rx, ry);
    const px = new Uint8Array(w * h);
    const span = MAP_REGION << level; // tiles across the region
    const tx0 = rx * span,
      ty0 = ry * span;
    const n = 1 << level; // tiles per pixel side
    const lit = level === 0 ? null : new Uint16Array(w * h);
    const t = this.world.tiles;
    // level-0 regions inside this one
    const r0x = Math.floor(tx0 / MAP_REGION),
      r0y = Math.floor(ty0 / MAP_REGION),
      rn = 1 << level;
    for (let ry0 = r0y; ry0 < Math.min(MAP_L0_ROWS, r0y + rn); ry0++)
      for (let rx0 = r0x; rx0 < Math.min(MAP_L0_COLS, r0x + rn); rx0++) {
        const chunks = this.edited.get(ry0 * MAP_L0_COLS + rx0);
        if (!chunks) continue;
        for (const ci of chunks) {
          const cx = ci % CHUNKS_X,
            cy = Math.floor(ci / CHUNKS_X);
          for (let dy = 0; dy < CHUNK; dy++) {
            const y = cy * CHUNK + dy,
              row = y * WORLD_W;
            for (let dx = 0; dx < CHUNK; dx++) {
              const x = cx * CHUNK + dx,
                v = t[row + x];
              const c = MAP_CLASS_OF_ID[v & LOMASK];
              if (c < OvClass.Road) continue; // landscape and parks never light up
              const li = mapLightIndex(v, x, y);
              if (!li) continue;
              if (lit) lit[Math.floor((y - ty0) / n) * w + Math.floor((x - tx0) / n)]++;
              else px[(y - ty0) * w + (x - tx0)] = li;
            }
          }
        }
      }
    if (lit) {
      const area = n * n;
      for (let i = 0; i < lit.length; i++) {
        if (!lit[i]) continue;
        // a busy city centre lights about a quarter of its tiles; only that reaches the full (still soft) glow
        px[i] = MAP_GLOW_BASE + Math.min(MAP_GLOW_STEPS - 1, Math.floor((lit[i] / area) * 3 * MAP_GLOW_STEPS));
      }
    }
    return encodeIndexedPng(
      w,
      h,
      px,
      MAP_LIGHTS_PALETTE.map((c) => [c[0], c[1], c[2]] as const),
      MAP_LIGHTS_PALETTE.map((c) => c[3]),
    );
  }
}
