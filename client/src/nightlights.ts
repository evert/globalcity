// City lights for the zoomed-in view at night. Micropolis has no night art, so the lights are derived from the
// day tiles once: on every built tile (homes, shops, industry, civic and special buildings) a deterministic
// share of its non-ground pixels become lit windows, and roads get a street lamp on alternate tiles. Each plot
// in darkness gets a transparent lights image (8 px per tile, so a window is 2x2 art pixels), drawn additively
// over the dimmed city. Images are rebuilt at most every couple of seconds as the city changes.
import { CHUNK, LOMASK } from '@globalcity/shared';
import type { SpriteSheet } from './assets.ts';

const PX = 8; // lights image pixels per tile
const CACHE_MAX = 48;
const REBUILD_MS = 2000;

/** Light colours, indexed by category. */
const COLOURS = ['#ffd678', '#fff6d6', '#ffaa50', '#fffaeb', '#ffe6a0', '#ffc878'];
const RES = 0, COM = 1, IND = 2, CIVIC = 3, SPECIAL = 4, LAMP = 5;

/** Category and share of lit pixels for a tile id, or null when the tile never lights up. */
function category(id: number): { c: number; share: number } | null {
  if (id >= 64 && id <= 206) return { c: LAMP, share: 0 }; // roads: lamps, handled separately
  if (id >= 240 && id <= 248) return null; // empty residential zone
  if (id >= 249 && id <= 404) return { c: RES, share: 0.025 };
  if (id >= 405 && id <= 422) return { c: CIVIC, share: 0.03 }; // hospital, church
  if (id >= 423 && id <= 431) return null; // empty commercial zone
  if (id >= 432 && id <= 611) return { c: COM, share: 0.04 };
  if (id >= 612 && id <= 620) return null; // empty industrial zone
  if (id >= 621 && id <= 692) return { c: IND, share: 0.02 };
  if (id >= 693 && id <= 826) return { c: SPECIAL, share: 0.02 }; // ports, airport, plants, stations, stadium
  if (id >= 960 && id <= 984) return { c: CIVIC, share: 0.03 }; // city hall, school
  if (id >= 1017 && id <= 1018) return { c: CIVIC, share: 0.025 }; // custom buildings (university, Grand Central)
  return null;
}

const hash = (a: number, b: number): number => ((((a * 2654435761) ^ (b * 2246822519)) >>> 0) % 1000) / 1000;

/** Ground and shadow colours of the 14-colour palette: never a window. */
const GROUND = new Set(['204,127,102', '153,127,76', '0,230,0', '0,127,0', '0,0,0', '102,102,230']);

export class NightLights {
  /** per tile id: packed lights (lx | ly << 3 | colour << 6), or undefined when the tile has none */
  private perTile: (Uint16Array | undefined)[] = [];
  private cache = new Map<string, { canvas: HTMLCanvasElement; builtAt: number; stale: boolean; lastUse: number }>();
  private uses = 0;

  constructor(sheet: SpriteSheet) {
    if (sheet.procedural) return; // no art to derive lights from
    const T = sheet.tileSize;
    const c = document.createElement('canvas');
    const w = (sheet.image as HTMLImageElement | HTMLCanvasElement).width, h = (sheet.image as HTMLImageElement | HTMLCanvasElement).height;
    c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(sheet.image, 0, 0);
    const data = g.getImageData(0, 0, w, h).data;
    for (let id = 0; id < sheet.count; id++) {
      const cat = category(id);
      if (!cat) continue;
      const ox = (id % sheet.cols) * T, oy = Math.floor(id / sheet.cols) * T;
      const out: number[] = [];
      if (cat.c === LAMP) {
        out.push((1 | (1 << 3) | (LAMP << 6)));
      } else {
        const seen = new Set<number>();
        for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
          const i = ((oy + y) * w + ox + x) * 4;
          if (GROUND.has(`${data[i]},${data[i + 1]},${data[i + 2]}`)) continue;
          if (hash(id * 256 + y * 16 + x, 7) >= cat.share) continue;
          const lx = Math.floor((x * PX) / T), ly = Math.floor((y * PX) / T), k = lx | (ly << 3);
          if (seen.has(k)) continue;
          seen.add(k);
          out.push(k | (cat.c << 6));
        }
      }
      if (out.length) this.perTile[id] = Uint16Array.from(out);
    }
  }

  /** The chunk's tiles changed: rebuild its lights soon (throttled). */
  markDirty(key: string): void { const e = this.cache.get(key); if (e) e.stale = true; }

  /** Lights image for a chunk (CHUNK*PX square), built or refreshed as needed. */
  canvasFor(key: string, cx: number, cy: number, tiles: Uint16Array, now: number): HTMLCanvasElement {
    let e = this.cache.get(key);
    if (e && !(e.stale && now - e.builtAt >= REBUILD_MS)) { e.lastUse = ++this.uses; return e.canvas; }
    const canvas = e?.canvas ?? document.createElement('canvas');
    canvas.width = canvas.height = CHUNK * PX;
    const g = canvas.getContext('2d')!;
    g.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < tiles.length; i++) {
      const id = tiles[i] & LOMASK;
      const lights = this.perTile[id];
      if (!lights) continue;
      const tx = i % CHUNK, ty = (i - tx) / CHUNK;
      for (const l of lights) {
        const col = l >> 6;
        if (col === LAMP && ((cx * CHUNK + tx + cy * CHUNK + ty) & 1)) continue; // a lamp on every other road tile
        g.fillStyle = COLOURS[col];
        g.fillRect(tx * PX + (l & 7), ty * PX + ((l >> 3) & 7), 1, 1);
      }
    }
    e = { canvas, builtAt: now, stale: false, lastUse: ++this.uses };
    this.cache.set(key, e);
    if (this.cache.size > CACHE_MAX) {
      let oldest: string | null = null, min = Infinity;
      for (const [k, v] of this.cache) if (v.lastUse < min) { min = v.lastUse; oldest = k; }
      if (oldest) this.cache.delete(oldest);
    }
    return canvas;
  }
}
