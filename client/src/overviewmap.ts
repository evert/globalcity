// Zoomed-out map view: terrain recoloured to the Micropolis tile palette with a static per-tile speckle,
// and every claimed plot as a one-pixel-per-tile image of what is actually built there.
import { CHUNK, OVERVIEW_PALETTE, OVERVIEW_SPECK, OvClass, OV_CLASS_MASK, OV_DARK, decodeOverview, chunkKey } from '@globalcity/shared';

/** Night lights per overview class: colour and the share of tiles that are lit (a deterministic pattern). */
const LIGHTS: Partial<Record<OvClass, { rgb: [number, number, number]; share: number; alpha: number }>> = {
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
const lit = (x: number, y: number, share: number): boolean => ((((x * 2654435761) ^ (y * 2246822519)) >>> 0) % 1000) < share * 1000;

const REFRESH_MS = 30_000;

/** Deterministic speck test for a tile: roughly one tile in nine gets the darker shade. */
const speck = (x: number, y: number): boolean => (((x * 73856093) ^ (y * 19349663)) >>> 0) % 9 === 0;

export class OverviewMap {
  private canvases = new Map<string, HTMLCanvasElement>();
  /** the same plots at night: lit windows and street lamps on a transparent background */
  private lights = new Map<string, HTMLCanvasElement>();
  /** share of a plot's tiles that are lit at night (0..1), for the glow around cities on the zoomed-out map */
  private litShare = new Map<string, number>();
  private fetchedAt = 0;
  private inflight = false;
  /** bumped on every new snapshot */
  version = 0;
  /** called when new chunk images are ready (renderer invalidates) */
  onUpdate: () => void = () => {};

  constructor(private readonly url = '/overview.bin') {}

  canvasFor(cx: number, cy: number): HTMLCanvasElement | undefined { return this.canvases.get(chunkKey(cx, cy)); }
  lightsFor(cx: number, cy: number): HTMLCanvasElement | undefined { return this.lights.get(chunkKey(cx, cy)); }
  litShareOf(cx: number, cy: number): number { return this.litShare.get(chunkKey(cx, cy)) ?? 0; }

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
    const nextLights = new Map<string, HTMLCanvasElement>();
    const nextShare = new Map<string, number>();
    for (const { cx, cy, classes } of decodeOverview(buf)) {
      const key = chunkKey(cx, cy);
      const c = this.canvases.get(key) ?? document.createElement('canvas');
      c.width = CHUNK; c.height = CHUNK;
      const g = c.getContext('2d')!;
      const img = g.createImageData(CHUNK, CHUNK);
      for (let i = 0; i < classes.length; i++) {
        const x = cx * CHUNK + (i % CHUNK), y = cy * CHUNK + Math.floor(i / CHUNK);
        const k = classes[i] & OV_CLASS_MASK;
        const [r, gg, b] = (speck(x, y) ? OVERVIEW_SPECK : OVERVIEW_PALETTE)[k] ?? OVERVIEW_PALETTE[0];
        img.data[i * 4] = r; img.data[i * 4 + 1] = gg; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      next.set(key, c);
      // night version: only the lights
      const lc = this.lights.get(key) ?? document.createElement('canvas');
      lc.width = CHUNK; lc.height = CHUNK;
      const lg = lc.getContext('2d')!;
      const li = lg.createImageData(CHUNK, CHUNK);
      let litTiles = 0;
      for (let i = 0; i < classes.length; i++) {
        if (classes[i] & OV_DARK) continue; // no power, or nothing built yet
        const L = LIGHTS[(classes[i] & OV_CLASS_MASK) as OvClass];
        if (!L) continue;
        const x = cx * CHUNK + (i % CHUNK), y = cy * CHUNK + Math.floor(i / CHUNK);
        if (!lit(x, y, L.share)) continue;
        li.data[i * 4] = L.rgb[0]; li.data[i * 4 + 1] = L.rgb[1]; li.data[i * 4 + 2] = L.rgb[2]; li.data[i * 4 + 3] = L.alpha;
        litTiles++;
      }
      nextShare.set(key, litTiles / classes.length);
      lg.putImageData(li, 0, 0);
      nextLights.set(key, lc);
    }
    this.canvases = next;
    this.lights = nextLights;
    this.litShare = nextShare;
    this.version++;
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
