// Real-time night for the world map: a 1-degree grid of how dark it is right now, drawn stretched (smoothed)
// over the map, so the line between day and night sweeps across the world as the Earth turns. Recomputed at
// most once a minute; the renderer asks for a redraw on the same cadence. `?day=<minutes>` speeds the day up.
import { nightLevel, subsolarPoint, sunElevation } from '@globalcity/shared';

const W = 360, H = 180;

/**
 * The sun's clock. Real time, unless the page address asks for a faster day to look at night art: `?day=5`
 * makes a full day last 5 minutes (counted from page load, starting at the real time of day).
 */
const DAY_MINUTES = (() => {
  try { const v = Number(new URLSearchParams(location.search).get('day')); return v > 0 ? v : 0; } catch { return 0; }
})();
const SPEED = DAY_MINUTES ? 1440 / DAY_MINUTES : 1;
const T0 = Date.now();
export const sunNow = (): number => T0 + (Date.now() - T0) * SPEED;
/** How often the night moves enough to redraw: a minute of sun time, but no more than twice a second. */
export const NIGHT_REFRESH_MS = Math.max(500, 60_000 / SPEED);
/** Darkest the map gets at night (alpha of the night colour), so everything stays readable. */
export const NIGHT_MAX = 0.6;
const NIGHT_RGB = [6, 10, 34];

export class NightLayer {
  readonly canvas = document.createElement('canvas');
  private computedAt = -Infinity;
  private sub = subsolarPoint(sunNow());

  constructor() { this.canvas.width = W; this.canvas.height = H; }

  /** Recompute the darkness grid if it is more than a minute (of sun time) old. Returns true when it changed. */
  update(): boolean {
    const now = sunNow();
    if (now - this.computedAt < 60_000) return false;
    this.computedAt = now;
    this.sub = subsolarPoint(now);
    const g = this.canvas.getContext('2d')!;
    const img = g.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      const lat = 90 - (y + 0.5);
      for (let x = 0; x < W; x++) {
        const lon = x + 0.5 - 180;
        const a = nightLevel(sunElevation(lat, lon, this.sub)) * NIGHT_MAX;
        const i = (y * W + x) * 4;
        img.data[i] = NIGHT_RGB[0]; img.data[i + 1] = NIGHT_RGB[1]; img.data[i + 2] = NIGHT_RGB[2];
        img.data[i + 3] = Math.round(a * 255);
      }
    }
    g.putImageData(img, 0, 0);
    return true;
  }

  /** How dark it is (0..1) at a latitude/longitude, from the last update. */
  levelAt(lat: number, lon: number): number { return nightLevel(sunElevation(lat, lon, this.sub)); }
}
