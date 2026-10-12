// Lit windows for the zoomed-in view at night. Micropolis has no night art, so the lights come from the day art:
// the windows are the single dots set in a wall (a dot whose left and right neighbours are the same wall colour,
// not part of a line, checker or hatch), so the lights follow the real window rows of every building. A fixed
// share of them is lit, the same for everyone. Each plot in darkness gets a transparent lights image at the art's
// own resolution, drawn over the dimmed city; custom buildings get one lights image per kind.
import { CHUNK, LOMASK } from '@globalcity/shared';
import type { SpriteSheet } from './assets.ts';

const CACHE_MAX = 24;
/** the glow is the lights shrunk by this much and stretched back with smoothing: a cheap blur that works everywhere */
const GLOW_SHRINK = 4;
const REBUILD_MS = 2000;
/** share of windows lit */
const LIT = 0.7;

/** Window light colours by kind of building. */
const RES = 0, COM = 1, IND = 2, CIVIC = 3;
const COLOURS = ['#ffd27a', '#fff0c8', '#ffb45a', '#ffe6a8'];

/** Light colour for a tile id, or -1 when the tile never lights up. */
function kindOf(id: number): number {
  if (id >= 249 && id <= 404) return RES;
  if (id >= 405 && id <= 422) return CIVIC; // hospital, church
  if (id >= 432 && id <= 611) return COM;
  if (id >= 621 && id <= 692) return IND;
  if (id >= 693 && id <= 826) return IND; // ports, airport, plants, stations, stadium
  if (id >= 960 && id <= 984) return CIVIC; // city hall, school
  return -1;
}

const rgb = (d: Uint8ClampedArray, i: number): number => (d[i + 3] < 128 ? -1 : (d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
const hex = (s: string): number => parseInt(s, 16);
/** grass, dirt and trees: never a wall */
const GROUND = new Set(['cc7f66', '997f4c', '00e600', '007f00'].map(hex));
/** the walls windows are set in (greys, blues, red brick) */
const WALL = new Set(['7f7f7f', '3f3f3f', 'bfbfbf', '0000e6', '6666e6', 'ff0000'].map(hex));

/** Soft glow image for a lights image: shrunk (averaging the lights over a few pixels), drawn back smoothed. */
function glowOf(lights: HTMLCanvasElement, into?: HTMLCanvasElement): HTMLCanvasElement {
  const c = into ?? document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(lights.width / GLOW_SHRINK)); c.height = Math.max(1, Math.ceil(lights.height / GLOW_SHRINK));
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, c.width, c.height);
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(lights, 0, 0, c.width, c.height);
  return c;
}

const hash = (a: number, b: number): number => ((((a * 2654435761) ^ (b * 2246822519)) >>> 0) % 1000) / 1000;

/**
 * Window dots in the w x h region at (ox, oy) of an image `iw` wide. `isWall` says which colours windows sit in.
 * Returns packed x | y << 16 offsets within the region.
 */
function findWindows(d: Uint8ClampedArray, iw: number, ox: number, oy: number, w: number, h: number, isWall: (c: number) => boolean): number[] {
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? -2 : rgb(d, ((oy + y) * iw + ox + x) * 4));
  const out: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 1; x < w - 1; x++) {
    const p = at(x, y), l = at(x - 1, y), r = at(x + 1, y);
    if (p < 0 || GROUND.has(p) || l !== r || l === p || !isWall(l)) continue;
    const u = at(x, y - 1), dn = at(x, y + 1);
    if (u === p && dn === p) continue; // a vertical line
    if (u !== l && dn !== l) continue; // not set in the wall
    if (at(x - 1, y - 1) === p || at(x + 1, y - 1) === p || at(x - 1, y + 1) === p || at(x + 1, y + 1) === p) continue; // checker or hatch
    out.push(x | (y << 16));
  }
  return out;
}

/** A lights image (one pixel per art pixel) and its soft glow (smaller: draw it stretched, smoothed). */
export interface NightImage { canvas: HTMLCanvasElement; glow: HTMLCanvasElement }

export class NightLights {
  /** per tile id: lit window offsets (x | y << 4 | colour << 8), or undefined when the tile has none */
  private perTile: (Uint16Array | undefined)[] = [];
  private readonly T: number;
  private cache = new Map<string, { canvas: HTMLCanvasElement; glow: HTMLCanvasElement; builtAt: number; stale: boolean; lastUse: number }>();
  private customs = new Map<HTMLImageElement, NightImage | null>();
  private uses = 0;

  constructor(sheet: SpriteSheet) {
    this.T = sheet.tileSize;
    if (sheet.procedural) return; // no art to derive lights from
    const T = sheet.tileSize;
    const img = sheet.image as HTMLImageElement | HTMLCanvasElement;
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(img, 0, 0);
    const data = g.getImageData(0, 0, c.width, c.height).data;
    for (let id = 0; id < sheet.count; id++) {
      const kind = kindOf(id);
      if (kind < 0) continue;
      const ox = (id % sheet.cols) * T, oy = Math.floor(id / sheet.cols) * T;
      const out: number[] = [];
      for (const k of findWindows(data, c.width, ox, oy, T, T, (col) => WALL.has(col))) {
        const x = k & 0xffff, y = k >> 16;
        if (hash(id * 256 + y * 16 + x, 7) < LIT) out.push(x | (y << 4) | (kind << 8));
      }
      if (out.length) this.perTile[id] = Uint16Array.from(out);
    }
  }

  /** The chunk's tiles changed: rebuild its lights soon (throttled). */
  markDirty(key: string): void { const e = this.cache.get(key); if (e) e.stale = true; }

  /** Lights image for a chunk (one pixel per art pixel), built or refreshed as needed. */
  canvasFor(key: string, tiles: Uint16Array, now: number): NightImage {
    let e = this.cache.get(key);
    if (e && !(e.stale && now - e.builtAt >= REBUILD_MS)) { e.lastUse = ++this.uses; return e; }
    const T = this.T;
    const canvas = e?.canvas ?? document.createElement('canvas');
    canvas.width = canvas.height = CHUNK * T;
    const g = canvas.getContext('2d')!;
    g.clearRect(0, 0, canvas.width, canvas.height);
    for (let col = 0; col < COLOURS.length; col++) {
      g.fillStyle = COLOURS[col];
      for (let i = 0; i < tiles.length; i++) {
        const lights = this.perTile[tiles[i] & LOMASK];
        if (!lights || (lights[0] >> 8) !== col) continue;
        const tx = i % CHUNK, ty = (i - tx) / CHUNK;
        for (const l of lights) g.fillRect(tx * T + (l & 15), ty * T + ((l >> 4) & 15), 1, 1);
      }
    }
    e = { canvas, glow: glowOf(canvas, e?.glow), builtAt: now, stale: false, lastUse: ++this.uses };
    this.cache.set(key, e);
    if (this.cache.size > CACHE_MAX) {
      let oldest: string | null = null, min = Infinity;
      for (const [k, v] of this.cache) if (v.lastUse < min) { min = v.lastUse; oldest = k; }
      if (oldest) this.cache.delete(oldest);
    }
    return e;
  }

  /** Lights image for a custom building's art (its first frame, `fw` pixels wide), or null when it has no windows. */
  forCustom(img: HTMLImageElement, fw: number): NightImage | null {
    if (this.customs.has(img)) return this.customs.get(img)!;
    let out: NightImage | null = null;
    try {
      const h = img.naturalHeight;
      const c = document.createElement('canvas');
      c.width = fw; c.height = h;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(img, 0, 0, fw, h, 0, 0, fw, h);
      const wins = findWindows(g.getImageData(0, 0, fw, h).data, fw, 0, 0, fw, h, (col) => col >= 0 && !GROUND.has(col));
      g.clearRect(0, 0, fw, h);
      g.fillStyle = COLOURS[CIVIC];
      let n = 0;
      for (const k of wins) {
        const x = k & 0xffff, y = k >> 16;
        if (hash(x * 4096 + y, 11) < LIT) { g.fillRect(x, y, 1, 1); n++; }
      }
      out = n ? { canvas: c, glow: glowOf(c) } : null;
    } catch { out = null; }
    this.customs.set(img, out);
    return out;
  }
}
