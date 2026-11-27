// Tool icons (toolbar, flyouts, milestones panel): each tool's art cropped to its visible pixels, centred in a
// square and drawn at the screen's pixel density, so single tiles stay crisp at 2x and whole buildings scale
// down cleanly instead of showing one tile out of the middle.
import { CUSTOM_BUILDINGS, DIRT, TOOLS, type ToolId } from '@globalcity/shared';
import type { SpriteSheet } from './assets.ts';
import { drawTile } from './assets.ts';
import type { CustomLayer } from './custom.ts';

/** Zones show their letter tile; a whole empty zone is mostly bare ground. */
const LETTER_ICON: ReadonlySet<ToolId> = new Set<ToolId>(['residential', 'commercial', 'industrial']);

interface Art {
  c: HTMLCanvasElement;
  ground: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface IconOpts {
  /** largest scale in CSS px per art px (single 16px tiles draw at 2x) */
  maxScale?: number;
  /** crop very wide art (Grand Central) to at most this width:height, keeping the middle; tall art fits whole */
  maxAspect?: number;
}

export const iconDpr = (): number => Math.min(4, Math.max(1, window.devicePixelRatio || 1));

export class ToolIcons {
  private readonly art = new Map<ToolId, Art>();
  private groundPx: number | null = null;
  constructor(
    private readonly sheet: SpriteSheet,
    private readonly customs: CustomLayer,
  ) {}

  /** Size `c` to `css` CSS px at the current pixel density and draw tool `id` into it. */
  paint(c: HTMLCanvasElement, id: ToolId, css: number, opts: IconOpts = {}): void {
    const t = TOOLS[id];
    const img = t.custom ? this.customs.images.get(t.custom) : undefined;
    if (img && !(img.complete && img.naturalWidth)) img.addEventListener('load', () => this.paint(c, id, css, opts), { once: true });
    const art = this.artFor(id);
    const box = Math.round(css * iconDpr());
    c.width = c.height = box;
    const g = c.getContext('2d')!;
    let { x, y, w, h } = art;
    const aspect = opts.maxAspect ?? Infinity;
    if (w > h * aspect) {
      const nw = h * aspect;
      x += (w - nw) / 2;
      w = nw;
    }
    const s = Math.min((opts.maxScale ?? 2) * iconDpr(), box / w, box / h);
    const ox = Math.round(box / 2 - (x + w / 2) * s),
      oy = Math.round(box / 2 - (y + h / 2) * s);
    g.fillStyle = art.ground;
    g.fillRect(0, 0, box, box);
    // sharp scaling: nearest-neighbour up to the next whole multiple, then a smooth step down the rest of the
    // way, so pixels stay square at any scale (exact when the scale is a whole number)
    const k = Math.max(1, Math.ceil(s - 1e-6));
    let src: CanvasImageSource = art.c;
    if (k > 1) {
      const up = document.createElement('canvas');
      up.width = art.c.width * k;
      up.height = art.c.height * k;
      const ug = up.getContext('2d')!;
      ug.imageSmoothingEnabled = false;
      ug.drawImage(art.c, 0, 0, up.width, up.height);
      src = up;
    }
    g.imageSmoothingEnabled = s !== k;
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, ox, oy, art.c.width * s, art.c.height * s);
  }

  /** The tool's art at 1 px per art px, with the box around its visible pixels (cached once loaded). */
  private artFor(id: ToolId): Art {
    const hit = this.art.get(id);
    if (hit) return hit;
    const t = TOOLS[id],
      ts = this.sheet.tileSize;
    const c = document.createElement('canvas');
    const g = c.getContext('2d', { willReadFrequently: true })!;
    const img = t.custom ? this.customs.ready(t.custom) : null;
    let final = true;
    if (img) {
      const def = CUSTOM_BUILDINGS[t.custom!];
      const fw = img.naturalWidth / (def.frames ?? 1),
        fh = img.naturalHeight;
      c.width = fw;
      c.height = fh;
      // on bare ground, as on the map, where the image is transparent (the Christmas tree)
      for (let y = 0; y < fh; y += ts) for (let x = 0; x < fw; x += ts) drawTile(g, this.sheet, DIRT, x, y, ts, ts);
      g.drawImage(img, 0, 0, fw, fh, 0, 0, fw, fh);
    } else if (t.base !== undefined && t.size > 1 && !LETTER_ICON.has(id)) {
      const n = t.size;
      c.width = c.height = n * ts;
      for (let k = 0; k < n * n; k++) drawTile(g, this.sheet, t.base + k, (k % n) * ts, Math.floor(k / n) * ts, ts, ts);
    } else {
      c.width = c.height = ts;
      drawTile(g, this.sheet, t.icon, 0, 0, ts, ts);
      final = !t.custom; // placeholder until the custom image loads
    }
    const art = { c, ...visibleBox(g, c.width, c.height, this.ground()) };
    if (final) this.art.set(id, art);
    return art;
  }

  /** The bare-ground colour: the most common pixel of the dirt tile (as a little-endian RGBA word). */
  private ground(): number {
    if (this.groundPx !== null) return this.groundPx;
    const ts = this.sheet.tileSize,
      c = document.createElement('canvas');
    c.width = c.height = ts;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    drawTile(g, this.sheet, DIRT, 0, 0, ts, ts);
    const counts = new Map<number, number>();
    for (const v of new Uint32Array(g.getImageData(0, 0, ts, ts).data.buffer)) counts.set(v, (counts.get(v) ?? 0) + 1);
    let best = 0;
    for (const [v, n] of counts)
      if (n > best) {
        best = n;
        this.groundPx = v;
      }
    return this.groundPx!;
  }
}

/** The box of rows and columns that are more than specks on bare ground (the whole art if there is none). */
function visibleBox(g: CanvasRenderingContext2D, w: number, h: number, ground: number): Omit<Art, 'c'> {
  const d = new Uint32Array(g.getImageData(0, 0, w, h).data.buffer);
  const rows = new Array<number>(h).fill(0),
    cols = new Array<number>(w).fill(0);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (d[y * w + x] !== ground) {
        rows[y]++;
        cols[x]++;
      }
  const span = (a: number[], min: number): [number, number] => {
    const lo = a.findIndex((n) => n > min);
    if (lo < 0) return [0, a.length];
    let hi = a.length - 1;
    while (hi > lo && a[hi] <= min) hi--;
    return [lo, hi + 1];
  };
  const [x0, x1] = span(cols, h / 8),
    [y0, y1] = span(rows, w / 8);
  const [r, gg, b, a] = new Uint8Array(new Uint32Array([ground]).buffer);
  return { ground: `rgba(${r},${gg},${b},${a / 255})`, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
