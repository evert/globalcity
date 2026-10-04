// Zoomed-out map view: terrain recoloured to the Micropolis tile palette with a static per-tile speckle,
// and every claimed plot as a one-pixel-per-tile image of what is actually built there.
import { CHUNK, OVERVIEW_PALETTE, OVERVIEW_SPECK, decodeOverview, chunkKey } from '@globalcity/shared';

const REFRESH_MS = 30_000;

/** Deterministic speck test for a tile: roughly one tile in nine gets the darker shade. */
const speck = (x: number, y: number): boolean => (((x * 73856093) ^ (y * 19349663)) >>> 0) % 9 === 0;

export class OverviewMap {
  private canvases = new Map<string, HTMLCanvasElement>();
  private fetchedAt = 0;
  private inflight = false;
  /** called when new chunk images are ready (renderer invalidates) */
  onUpdate: () => void = () => {};

  constructor(private readonly url = '/overview.bin') {}

  canvasFor(cx: number, cy: number): HTMLCanvasElement | undefined { return this.canvases.get(chunkKey(cx, cy)); }

  /** Fetch a fresh snapshot if the last one is older than REFRESH_MS (call while the overview is on screen). */
  maybeRefresh(now = Date.now()): void {
    if (this.inflight || now - this.fetchedAt < REFRESH_MS) return;
    this.inflight = true;
    this.fetchedAt = now;
    fetch(this.url, { cache: 'no-store' })
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((buf) => { this.ingest(buf); this.onUpdate(); })
      .catch((e) => console.warn('[overview] fetch failed:', (e as Error).message))
      .finally(() => { this.inflight = false; });
  }

  ingest(buf: ArrayBuffer): void {
    const next = new Map<string, HTMLCanvasElement>();
    for (const { cx, cy, classes } of decodeOverview(buf)) {
      const key = chunkKey(cx, cy);
      const c = this.canvases.get(key) ?? document.createElement('canvas');
      c.width = CHUNK; c.height = CHUNK;
      const g = c.getContext('2d')!;
      const img = g.createImageData(CHUNK, CHUNK);
      for (let i = 0; i < classes.length; i++) {
        const x = cx * CHUNK + (i % CHUNK), y = cy * CHUNK + Math.floor(i / CHUNK);
        const k = classes[i];
        const [r, gg, b] = (speck(x, y) ? OVERVIEW_SPECK : OVERVIEW_PALETTE)[k] ?? OVERVIEW_PALETTE[0];
        img.data[i * 4] = r; img.data[i * 4 + 1] = gg; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      next.set(key, c);
    }
    this.canvases = next;
  }
}

/**
 * Recolour the world minimap (water / land / forest from tools/gen-world) to the tile palette, so the
 * zoomed-out terrain matches the zoomed-in art.
 */
export function recolourMinimap(src: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(src, 0, 0);
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  const [land, water, trees] = [OVERVIEW_PALETTE[0], OVERVIEW_PALETTE[1], OVERVIEW_PALETTE[2]];
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], gg = d[i + 1], b = d[i + 2];
    const out = b > r && b > gg ? water : gg > r + 20 && r < 80 ? trees : land;
    d[i] = out[0]; d[i + 1] = out[1]; d[i + 2] = out[2];
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** 64x64 transparent tile with dark specks; drawn as a world-anchored pattern, one pattern pixel per tile. */
export function speckleTile(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d')!;
  const img = g.createImageData(64, 64);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    if (!speck(x, y)) continue;
    const i = (y * 64 + x) * 4;
    img.data[i + 3] = 70; // black at ~27% opacity: darker dirt / water / forest specks
  }
  g.putImageData(img, 0, 0);
  return c;
}
