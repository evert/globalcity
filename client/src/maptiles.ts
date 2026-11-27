// The zoomed-out map, drawn from server-rendered region images (shared/src/maptiles.ts). Only the regions on
// screen are fetched, at the level whose pixels are about one screen pixel, so the work per frame and the data
// per visit stay the same however many cities there are. Images are decoded off the main thread
// (createImageBitmap) and kept in a small LRU; a region that isn't loaded yet is drawn from a coarser level.
import { WORLD_W, WORLD_H, MAP_REGION, mapLevels, mapL0Cols, mapRegionGrid, mapRegionSize, mapRegionVersion, type MapManifest } from '@globalcity/shared';

export type MapKind = 'day' | 'lights';
const MANIFEST_MS = 30_000;
const MAX_BITMAPS = 240; // 256x256 each: about 60 MB at most
const MAX_INFLIGHT = 6;

interface Entry {
  img: ImageBitmap;
  ver: number;
  lastUse: number;
}

/** Maps world tile coordinates to device pixels on the canvas being drawn. */
export interface MapView {
  x(tx: number): number;
  y(ty: number): number;
}

export class MapTileLayer {
  private manifest: MapManifest | null = null;
  private lit = new Set<number>();
  private readonly bitmaps = new Map<string, Entry>();
  private readonly inflight = new Set<string>();
  private queue: { key: string; url: string; ver: number }[] = [];
  private fetchedAt = -Infinity;
  private manifestInflight = false;
  private frame = 0;
  /** bumped when an image arrives or the manifest changes: anything cached from the old state is stale */
  version = 0;
  onUpdate: () => void = () => {};
  /** the whole world at the top level (256 x 128), once loaded: the corner minimap */
  onWorldImage: (img: ImageBitmap) => void = () => {};

  constructor(private readonly base = '/map') {}

  get ready(): boolean {
    return this.manifest !== null;
  }

  /** Fetch the manifest if the last one is older than MANIFEST_MS (call while the map is on screen). */
  maybeRefresh(now = Date.now()): void {
    if (this.manifestInflight || now - this.fetchedAt < MANIFEST_MS) return;
    this.manifestInflight = true;
    this.fetchedAt = now;
    fetch(`${this.base}/manifest`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((m: MapManifest) => {
        const changed = !this.manifest || this.manifest.w !== m.w || this.manifest.v.some((v, i) => v !== m.v[i]);
        this.manifest = m;
        this.lit = new Set(m.lit);
        if (changed) {
          this.version++;
          this.onUpdate();
        }
        this.want('day', mapLevels() - 1, 0, 0); // the whole world, for the minimap and as the fallback under everything
      })
      .catch((e) => console.warn('[map] manifest failed:', (e as Error).message))
      .finally(() => {
        this.manifestInflight = false;
      });
  }

  /** Level whose pixels are at least one device pixel, for `devicePxPerTile`. */
  static levelFor(devicePxPerTile: number): number {
    if (devicePxPerTile >= 1) return 0;
    return Math.min(mapLevels() - 1, Math.max(0, Math.ceil(Math.log2(1 / devicePxPerTile) - 1e-9)));
  }

  private hasLights(level: number, rx: number, ry: number): boolean {
    const n = 1 << level;
    for (let y = ry * n; y < (ry + 1) * n; y++) for (let x = rx * n; x < (rx + 1) * n; x++) if (this.lit.has(y * mapL0Cols() + x)) return true;
    return false;
  }

  private url(kind: MapKind, level: number, rx: number, ry: number, ver: number): string {
    return `${this.base}/${kind}/${level}/${rx}/${ry}.png?w=${encodeURIComponent(this.manifest?.w ?? '')}&v=${ver}`;
  }

  /** The current image for a region, starting a fetch when it's missing or out of date. */
  private want(kind: MapKind, level: number, rx: number, ry: number): ImageBitmap | null {
    if (!this.manifest) return null;
    const key = `${kind}/${level}/${rx}/${ry}`;
    const ver = mapRegionVersion(this.manifest.v, level, rx, ry);
    const e = this.bitmaps.get(key);
    if (e) e.lastUse = this.frame;
    if ((!e || e.ver !== ver) && !this.inflight.has(key) && !this.queue.some((q) => q.key === key)) {
      this.queue.push({ key, url: this.url(kind, level, rx, ry, ver), ver });
      this.pump();
    }
    return e?.img ?? null; // an out-of-date image is still better than nothing while the new one loads
  }

  private pump(): void {
    while (this.inflight.size < MAX_INFLIGHT && this.queue.length) {
      const { key, url, ver } = this.queue.shift()!;
      this.inflight.add(key);
      fetch(url)
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((b) => createImageBitmap(b))
        .then((img) => {
          this.bitmaps.get(key)?.img.close();
          this.bitmaps.set(key, { img, ver, lastUse: this.frame });
          if (key === `day/${mapLevels() - 1}/0/0`) this.onWorldImage(img);
          this.evict();
          this.version++;
          this.onUpdate();
        })
        .catch((e) => console.warn('[map] image failed:', key, (e as Error).message))
        .finally(() => {
          this.inflight.delete(key);
          this.pump();
        });
    }
  }

  private evict(): void {
    if (this.bitmaps.size <= MAX_BITMAPS) return;
    const top = `day/${mapLevels() - 1}/0/0`;
    const old = [...this.bitmaps.entries()].filter(([k]) => k !== top).sort((a, b) => a[1].lastUse - b[1].lastUse);
    for (let i = 0; i < old.length && this.bitmaps.size > MAX_BITMAPS; i++) {
      if (old[i][1].lastUse === this.frame) break; // on screen now
      old[i][1].img.close();
      this.bitmaps.delete(old[i][0]);
    }
  }

  /**
   * Draw `kind` for the screen rectangle (rx0, ry0)-(rx1, ry1) (device pixels) at `level`. Missing regions are
   * filled from the nearest coarser level that is loaded. Returns how many regions are still loading.
   */
  draw(g: CanvasRenderingContext2D, kind: MapKind, level: number, view: MapView, rx0: number, ry0: number, rx1: number, ry1: number): number {
    if (!this.manifest) return 0;
    this.frame++;
    const span = MAP_REGION << level;
    const { cols, rows } = mapRegionGrid(level);
    // visible region range from the screen rectangle
    const tx = (px: number) => {
      const a = view.x(0),
        b = view.x(WORLD_W);
      return ((px - a) / (b - a)) * WORLD_W;
    };
    const ty = (py: number) => {
      const a = view.y(0),
        b = view.y(WORLD_H);
      return ((py - a) / (b - a)) * WORLD_H;
    };
    const c0 = Math.max(0, Math.floor(tx(rx0) / span)),
      c1 = Math.min(cols - 1, Math.floor((tx(rx1) - 1e-6) / span));
    const r0 = Math.max(0, Math.floor(ty(ry0) / span)),
      r1 = Math.min(rows - 1, Math.floor((ty(ry1) - 1e-6) / span));
    let missing = 0;
    for (let ry = r0; ry <= r1; ry++)
      for (let rx = c0; rx <= c1; rx++) {
        if (kind === 'lights' && !this.hasLights(level, rx, ry)) continue;
        const { w, h } = mapRegionSize(level, rx, ry);
        const wx0 = rx * span,
          wy0 = ry * span,
          wx1 = wx0 + (w << level),
          wy1 = wy0 + (h << level);
        const dx0 = view.x(wx0),
          dy0 = view.y(wy0),
          dw = view.x(wx1) - dx0,
          dh = view.y(wy1) - dy0;
        const img = this.want(kind, level, rx, ry);
        if (img) {
          g.drawImage(img, 0, 0, w, h, dx0, dy0, dw, dh);
          continue;
        }
        missing++;
        // fall back to a coarser level that is loaded (never fetch for it: the top level is always on its way)
        for (let L = level + 1; L < mapLevels(); L++) {
          const aspan = MAP_REGION << L,
            ax = Math.floor(wx0 / aspan),
            ay = Math.floor(wy0 / aspan);
          const e = this.bitmaps.get(`${kind}/${L}/${ax}/${ay}`);
          if (!e) continue;
          const sx = (wx0 - ax * aspan) >> L,
            sy = (wy0 - ay * aspan) >> L;
          const sw = Math.max(1, (w << level) >> L),
            sh = Math.max(1, (h << level) >> L);
          g.drawImage(e.img, sx, sy, sw, sh, dx0, dy0, dw, dh);
          break;
        }
      }
    return missing;
  }

  /** Test hook: number of decoded region images held. */
  get bitmapCount(): number {
    return this.bitmaps.size;
  }
}
