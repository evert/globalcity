// Real weather over the map (server/src/weather.ts: NOAA's GFS forecast for the current hour, as a 0.5-degree image
// whose red channel is cloud cover, green the rain or snow rate with its lowest bit set where it is snow, blue the
// air temperature).
//   zoomed out  clouds drift over the world map, darker where it rains, over the city lights (shaded by the night)
//   zoomed in   the sky dims under cloud, and rain or snow falls across the screen where the camera is
// Zoomed in it is always on. The zoomed-out clouds are off until the player turns them on (the Weather button);
// that choice is remembered. `?weather=rain|snow|storm|clear` overrides what falls at the camera, to look at the effect.
import { WORLD_H, WORLD_W } from '@globalcity/shared';

const W = 720,
  H = 360;
/** How often to ask the server which hour it has (the image itself is only fetched when that changes). */
const POLL_MS = 10 * 60_000;
const STORAGE_KEY = 'globalcity.weather';

export interface WeatherHere {
  /** cloud cover, 0..1 */
  cloud: number;
  /** how hard it rains or snows, 0..1 (square-root scaled: 0.3 is light rain, 1 is 10 mm/h or more) */
  precip: number;
  snow: boolean;
  /** air temperature 2 m above the ground, degC (null without weather) */
  temp: number | null;
}

/** The rain rate in mm/h for a `precip` value. */
export const precipMmH = (precip: number): number => precip * precip * 10;

const OVERRIDE: WeatherHere | null = (() => {
  try {
    switch (new URLSearchParams(location.search).get('weather')) {
      case 'rain':
        return { cloud: 1, precip: 0.5, snow: false, temp: 12 };
      case 'storm':
        return { cloud: 1, precip: 1, snow: false, temp: 18 };
      case 'snow':
        return { cloud: 1, precip: 0.6, snow: true, temp: -3 };
      case 'clear':
        return { cloud: 0, precip: 0, snow: false, temp: 20 };
    }
  } catch {
    /* no location (tests) */
  }
  return null;
})();

function readEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export class WeatherLayer {
  /** the zoomed-out map's clouds: white to rain-grey, alpha by cover */
  readonly clouds = document.createElement('canvas');
  /** the zoomed-in view's overcast: a dark veil by cover and rain */
  readonly shade = document.createElement('canvas');
  /** bumped whenever a new hour arrives or the layer is turned on or off */
  version = 0;
  /** the player wants the clouds on the zoomed-out map */
  enabled = readEnabled();
  /** an hour has arrived */
  ready = false;
  onChange: () => void = () => {};
  private data: Uint8ClampedArray | null = null;
  private valid: number | null = null;
  private readonly shaded = document.createElement('canvas');
  private shadedKey = '';

  constructor() {
    this.clouds.width = this.shade.width = W;
    this.clouds.height = this.shade.height = H;
  }

  /** the zoomed-out clouds are showing: on and loaded */
  get cloudsShown(): boolean {
    return this.enabled && this.ready;
  }

  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    try {
      localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
    } catch {
      /* private mode */
    }
    this.version++;
    this.onChange();
  }

  private started = false;
  /** Start fetching the weather: now, then every POLL_MS. */
  start(): void {
    if (this.started) return;
    this.started = true;
    void this.poll();
    setInterval(() => {
      void this.poll();
    }, POLL_MS);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void this.poll();
    });
  }

  private async poll(): Promise<void> {
    try {
      const r = await fetch('/api/weather.json', { cache: 'no-cache' });
      if (!r.ok) return;
      const { valid } = (await r.json()) as { valid: number | null };
      if (valid === null || valid === this.valid) return;
      const img = new Image();
      img.src = `/api/weather?v=${valid}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(img, 0, 0, W, H);
      this.data = g.getImageData(0, 0, W, H).data;
      this.valid = valid;
      this.paint();
      this.ready = true;
      this.version++;
      this.onChange();
    } catch {
      /* no weather: the map just stays clear */
    }
  }

  private paint(): void {
    const d = this.data!;
    const cg = this.clouds.getContext('2d')!,
      sg = this.shade.getContext('2d')!;
    const ci = cg.createImageData(W, H),
      si = sg.createImageData(W, H);
    for (let i = 0; i < W * H * 4; i += 4) {
      const cover = d[i] / 255,
        p = (d[i + 1] & 0xfe) / 248;
      const a = Math.pow(Math.max(0, (cover - 0.15) / 0.85), 1.3) * 0.8;
      const grey = 250 - p * 120;
      ci.data[i] = grey;
      ci.data[i + 1] = grey;
      ci.data[i + 2] = grey + p * 12; // rain clouds a touch blue
      ci.data[i + 3] = a * 255;
      si.data[i + 3] = Math.min(0.4, cover * 0.16 + p * 0.25) * 255;
    }
    cg.putImageData(ci, 0, 0);
    sg.putImageData(si, 0, 0);
  }

  /** The clouds with the night shade on them (only where there is cloud), to draw over the city lights. */
  shadedClouds(night: HTMLCanvasElement, nightVersion: number): HTMLCanvasElement {
    const key = `${this.version}|${nightVersion}`;
    if (key !== this.shadedKey) {
      this.shadedKey = key;
      const c = this.shaded;
      c.width = W;
      c.height = H; // also clears it
      const g = c.getContext('2d')!;
      g.drawImage(this.clouds, 0, 0);
      g.globalCompositeOperation = 'source-atop';
      g.imageSmoothingEnabled = true;
      g.drawImage(night, 0, 0, W, H);
    }
    return this.shaded;
  }

  /** When the weather is for (epoch ms), null until it arrives. */
  get validAt(): number | null {
    return this.ready ? this.valid : null;
  }

  /** The weather at a tile (bilinear between the grid's points). */
  at(tx: number, ty: number): WeatherHere {
    if (OVERRIDE) return OVERRIDE;
    const d = this.data;
    if (!d) return { cloud: 0, precip: 0, snow: false, temp: null };
    const fx = (tx / WORLD_W) * W - 0.5,
      fy = Math.min(H - 1, Math.max(0, (ty / WORLD_H) * H - 0.5));
    const x0 = Math.floor(fx),
      y0 = Math.floor(fy),
      ax = fx - x0,
      ay = fy - y0;
    const px = (x: number, y: number, ch: number): number => d[(Math.min(H - 1, y) * W + ((x + W) % W)) * 4 + ch];
    const at = (x: number, y: number, ch: number): number => (ch === 1 ? px(x, y, 1) & 0xfe : px(x, y, ch));
    const lerp = (ch: number): number =>
      (at(x0, y0, ch) * (1 - ax) + at(x0 + 1, y0, ch) * ax) * (1 - ay) + (at(x0, y0 + 1, ch) * (1 - ax) + at(x0 + 1, y0 + 1, ch) * ax) * ay;
    const snow = px(Math.round(fx), Math.round(fy), 1) & 1; // the nearest point: a yes or no doesn't blend
    return { cloud: lerp(0) / 255, precip: lerp(1) / 248, snow: snow === 1, temp: lerp(2) / 2 - 60 };
  }
}

interface Drop {
  x: number;
  y: number;
  v: number; // speed, px per second
  s: number; // size
  ph: number; // sway phase (snow)
}

/**
 * Rain or snow falling across the screen while zoomed in, from the weather at the camera. A canvas of its own over
 * the map, animated only while something falls, so the map itself is not redrawn every frame for it.
 */
export class Precipitation {
  private readonly canvas = document.createElement('canvas');
  private readonly g = this.canvas.getContext('2d')!;
  private drops: Drop[] = [];
  private running = false;
  private last = 0;
  private readonly reduced = matchMedia('(prefers-reduced-motion: reduce)');

  constructor(
    mapCanvas: HTMLCanvasElement,
    private readonly view: { isTileMode(): boolean; cam: { x: number; y: number } },
    private readonly weather: WeatherLayer,
  ) {
    Object.assign(this.canvas.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', pointerEvents: 'none' });
    this.canvas.setAttribute('aria-hidden', 'true');
    mapCanvas.after(this.canvas);
    setInterval(() => this.check(), 1000);
  }

  /** What falls at the camera now, or null (zoomed out, nothing falling, or reduced motion). */
  private here(): WeatherHere | null {
    if (this.reduced.matches || document.hidden || !this.view.isTileMode()) return null;
    const w = this.weather.at(this.view.cam.x, this.view.cam.y);
    return w.precip >= 0.15 ? w : null;
  }

  private check(): void {
    if (this.running || !this.here()) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  private frame(now: number): void {
    const w = this.here();
    const dpr = devicePixelRatio || 1,
      cw = Math.round(innerWidth * dpr),
      ch = Math.round(innerHeight * dpr);
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    const g = this.g;
    g.clearRect(0, 0, cw, ch);
    if (!w) {
      this.running = false;
      this.drops = [];
      return;
    }
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    // drops per screen: from a drizzle to a downpour, scaled with the screen's area
    const want = Math.round((w.snow ? 260 : 420) * w.precip * ((cw * ch) / (1600 * 1000 * dpr * dpr)) + 20);
    while (this.drops.length < want) this.drops.push(this.spawn(cw, ch, w.snow, true));
    if (this.drops.length > want) this.drops.length = want;
    if (w.snow) {
      g.fillStyle = 'rgba(255,255,255,0.85)';
      for (const d of this.drops) {
        d.y += d.v * dt;
        d.ph += dt;
        d.x += Math.sin(d.ph * 1.3) * 18 * dt * dpr;
        if (d.y > ch + 4) Object.assign(d, this.spawn(cw, ch, true, false));
        g.beginPath();
        g.arc(d.x, d.y, d.s, 0, Math.PI * 2);
        g.fill();
      }
    } else {
      g.strokeStyle = 'rgba(190,205,240,0.45)';
      g.lineWidth = Math.max(1, dpr);
      g.beginPath();
      for (const d of this.drops) {
        d.y += d.v * dt;
        d.x -= d.v * 0.12 * dt;
        if (d.y > ch + 20) Object.assign(d, this.spawn(cw, ch, false, false));
        g.moveTo(d.x, d.y);
        g.lineTo(d.x + d.s * 0.12, d.y - d.s);
      }
      g.stroke();
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  private spawn(cw: number, ch: number, snow: boolean, anywhere: boolean): Drop {
    const dpr = devicePixelRatio || 1;
    return {
      x: Math.random() * (cw + 40) - 20,
      y: anywhere ? Math.random() * ch : -20,
      v: (snow ? 40 + Math.random() * 40 : 700 + Math.random() * 300) * dpr,
      s: (snow ? 1 + Math.random() * 1.6 : 10 + Math.random() * 10) * dpr,
      ph: Math.random() * 10,
    };
  }
}
