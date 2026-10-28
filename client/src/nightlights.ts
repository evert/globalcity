// Lit windows for the zoomed-in view at night. The lights are authored per building (art/nightlights/lights.py)
// into a lights sheet with the same layout as the tile sheet, holding only the lit pixels: opaque pixels are
// lights (each gets a faint halo), translucent ones a wash of light (no halo). Custom buildings have their own
// lights image next to their art (<name>-night.png). Each plot in darkness gets a transparent lights image at the
// art's own resolution, drawn over the dimmed city.
import { CHUNK, LOMASK, PWRBIT } from '@globalcity/shared';
import type { SpriteSheet } from './assets.ts';
import { versioned } from './assets.ts';

/** lit plots kept beyond the ones on screen (plots on screen are never evicted, so a big view can't thrash) */
const CACHE_MAX = 16;

/** radius (art pixels) and peak strength of the soft halo around every light */
const HALO_R = 3;
const HALO_ALPHA = 0.22;
const halos = new Map<number, HTMLCanvasElement>();
/** A small soft halo in a light's colour, stamped around it: every light gets the same bleed. */
function halo(rgb: number): HTMLCanvasElement {
  let c = halos.get(rgb);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = HALO_R * 2 + 1;
  const g = c.getContext('2d')!;
  const r = rgb >> 16, gr = (rgb >> 8) & 255, b = rgb & 255;
  const grad = g.createRadialGradient(HALO_R + 0.5, HALO_R + 0.5, 0, HALO_R + 0.5, HALO_R + 0.5, HALO_R + 0.5);
  grad.addColorStop(0, `rgba(${r},${gr},${b},${HALO_ALPHA})`);
  grad.addColorStop(1, `rgba(${r},${gr},${b},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  halos.set(rgb, c);
  return c;
}

/** Halo stamps (x, y, rgb) for the opaque pixels of an image region. */
function lightsIn(d: Uint8ClampedArray, iw: number, ox: number, oy: number, w: number, h: number): number[] {
  const out: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = ((oy + y) * iw + ox + x) * 4;
    if (d[i + 3] === 255) out.push(x, y, (d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
  }
  return out;
}

/** Glow image (w x h) with a halo around each light; overlapping halos don't add up. */
function glowOf(w: number, h: number, stamps: number[], into?: HTMLCanvasElement): HTMLCanvasElement {
  const c = into ?? document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, w, h);
  g.globalCompositeOperation = 'lighten';
  for (let i = 0; i < stamps.length; i += 3) g.drawImage(halo(stamps[i + 2]), stamps[i] - HALO_R, stamps[i + 1] - HALO_R);
  g.globalCompositeOperation = 'source-over';
  return c;
}

const loadImage = (url: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error(`failed to load ${url}`));
  img.src = url;
});

/** A lights image (one pixel per art pixel) and its soft glow (same size). */
export interface NightImage { canvas: HTMLCanvasElement; glow: HTMLCanvasElement }

export class NightLights {
  /** the lights sheet, once loaded */
  private sheet: HTMLImageElement | null = null;
  /** per tile id: halo stamps (x, y, rgb within the tile), or undefined when the tile has no lights */
  private perTile: (number[] | undefined)[] = [];
  private readonly T: number;
  private cols = 1;
  /** per tile id: its halos as one small image (tile plus HALO_R all round), made on first use */
  private tileGlows: (HTMLCanvasElement | undefined)[] = [];
  /** per plot: which lit tiles it has (`sig`) and their image, or null when nothing in it is lit */
  private cache = new Map<string, { sig: number; im: NightImage | null; stale: boolean; lastFrame: number }>();
  private customs = new Map<string, NightImage | null | 'loading'>();
  /** called when lights art finishes loading, so the view can redraw */
  onReady: () => void = () => {};

  constructor(sheet: SpriteSheet) {
    this.T = sheet.tileSize;
    if (sheet.procedural) return; // no art, no lights
    loadImage(versioned('/assets/micropolis/tiles-night.png')).then((img) => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(img, 0, 0);
      const data = g.getImageData(0, 0, c.width, c.height).data;
      const T = this.T, cols = Math.floor(c.width / T), rows = Math.floor(c.height / T);
      for (let id = 0; id < cols * rows; id++) {
        const ox = (id % cols) * T, oy = Math.floor(id / cols) * T;
        let any = false;
        for (let y = 0; y < T && !any; y++) for (let x = 0; x < T; x++) if (data[((oy + y) * c.width + ox + x) * 4 + 3]) { any = true; break; }
        if (any) this.perTile[id] = lightsIn(data, c.width, ox, oy, T, T);
      }
      this.cols = cols;
      this.sheet = img;
      this.cache.clear();
      this.onReady();
    }).catch(() => { /* no lights sheet: the city just dims at night */ });
  }

  /** The chunk's tiles changed: check its lights on the next frame (a cheap signature; most changes are traffic). */
  markDirty(key: string): void { const e = this.cache.get(key); if (e) e.stale = true; }

  /** Lights image for a chunk (one pixel per art pixel), built or refreshed as needed; null before the art loads
   *  or when nothing in the chunk is lit. `frame` is the renderer's frame number: chunks used this frame stay cached. */
  canvasFor(key: string, tiles: Uint16Array, frame: number): NightImage | null {
    if (!this.sheet) return null;
    let e = this.cache.get(key);
    if (e && !e.stale) { e.lastFrame = frame; return e.im; }
    // only lit, powered tiles matter: skip the redraw when they are the same as last time (most tile changes are traffic)
    const sig = this.signature(tiles);
    if (e && e.sig === sig) { e.stale = false; e.lastFrame = frame; return e.im; }
    const im = sig === 0 ? null : this.draw(tiles, e?.im ?? null);
    e = { sig, im, stale: false, lastFrame: frame };
    this.cache.set(key, e);
    this.evict(frame);
    return im;
  }

  /** Hash of the chunk's lit, powered tiles (position and id); 0 when there are none. */
  private signature(tiles: Uint16Array): number {
    let h = 0;
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      if (!(t & PWRBIT) || !this.perTile[t & LOMASK]) continue;
      h = Math.imul(h ^ ((i << 10) | (t & LOMASK)), 0x9e3779b1) ^ (h >>> 15);
      if (h === 0) h = 1;
    }
    return h;
  }

  /** Draw a chunk's lights (into `reuse` when given), and its glow from each lit tile's ready-made halos. */
  private draw(tiles: Uint16Array, reuse: NightImage | null): NightImage {
    const sheet = this.sheet!, T = this.T, cols = this.cols;
    const canvas = reuse?.canvas ?? document.createElement('canvas');
    const glow = reuse?.glow ?? document.createElement('canvas');
    canvas.width = canvas.height = glow.width = glow.height = CHUNK * T;
    const g = canvas.getContext('2d')!, gg = glow.getContext('2d')!;
    g.clearRect(0, 0, canvas.width, canvas.height);
    gg.clearRect(0, 0, glow.width, glow.height);
    gg.globalCompositeOperation = 'lighten'; // overlapping halos don't add up
    for (let i = 0; i < tiles.length; i++) {
      if (!(tiles[i] & PWRBIT)) continue; // no power, no lights
      const id = tiles[i] & LOMASK;
      if (!this.perTile[id]) continue;
      const tx = i % CHUNK, ty = (i - tx) / CHUNK;
      g.drawImage(sheet, (id % cols) * T, Math.floor(id / cols) * T, T, T, tx * T, ty * T, T, T);
      gg.drawImage(this.tileGlow(id), tx * T - HALO_R, ty * T - HALO_R);
    }
    gg.globalCompositeOperation = 'source-over';
    return { canvas, glow };
  }

  private tileGlow(id: number): HTMLCanvasElement {
    let c = this.tileGlows[id];
    if (!c) {
      const s = this.perTile[id]!.slice();
      for (let k = 0; k < s.length; k += 3) { s[k] += HALO_R; s[k + 1] += HALO_R; }
      c = this.tileGlows[id] = glowOf(this.T + 2 * HALO_R, this.T + 2 * HALO_R, s);
    }
    return c;
  }

  /** Drop the least recently used lit chunks beyond CACHE_MAX, never one drawn this frame; forget old unlit ones. */
  private evict(frame: number): void {
    const lit = [...this.cache].filter(([, v]) => v.im && v.lastFrame !== frame).sort((a, b) => a[1].lastFrame - b[1].lastFrame);
    let over = [...this.cache.values()].filter((v) => v.im).length - CACHE_MAX;
    for (const [k] of lit) { if (over-- <= 0) break; this.cache.delete(k); }
    if (this.cache.size > 4096) for (const [k, v] of this.cache) if (!v.im && v.lastFrame !== frame) this.cache.delete(k);
  }

  /** Lights image for a custom building (its art path, e.g. /assets/buildings/university.png), or null when it has none. */
  forCustom(image: string): NightImage | null {
    const got = this.customs.get(image);
    if (got !== undefined) return got === 'loading' ? null : got;
    this.customs.set(image, 'loading');
    loadImage(versioned(image.replace(/\.png$/, '-night.png'))).then((img) => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(img, 0, 0);
      const stamps = lightsIn(g.getImageData(0, 0, c.width, c.height).data, c.width, 0, 0, c.width, c.height);
      this.customs.set(image, { canvas: c, glow: glowOf(c.width, c.height, stamps) });
      this.onReady();
    }).catch(() => this.customs.set(image, null));
    return null;
  }
}
