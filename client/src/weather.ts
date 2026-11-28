// Real weather over the map (server/src/weather.ts: NOAA's GFS forecast for the current hour, as a 0.5-degree image
// whose red channel is cloud cover, green the rain or snow rate with its lowest bit set where it is snow, blue the
// air temperature).
//   zoomed out  clouds drift over the world map, darker where it rains, over the city lights (shaded by the night)
//   zoomed in   by day clouds cast drifting shadows, as much of the ground as the sky is covered; the city dims
//               where it rains; rain or snow falls across the screen where the camera is
// Zoomed in it is always on. The zoomed-out clouds are off until the player turns them on (the Weather button);
// that choice is remembered. `?weather=rain|snow|storm|broken|clear` overrides what falls at the camera, to look at the effect.
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
      case 'broken':
        return { cloud: 0.5, precip: 0, snow: false, temp: 22 };
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
  /** the zoomed-in view's rain gloom: a dark veil where it rains (the clouds themselves are the shadows) */
  readonly shade = document.createElement('canvas');
  /** bumped whenever a new hour arrives or the layer is turned on or off */
  version = 0;
  /** the player wants the clouds on the zoomed-out map */
  enabled = readEnabled();
  /** an hour has arrived */
  ready = false;
  onChange: () => void = () => {};
  private readonly listeners: (() => void)[] = [];
  /** Also call `fn` whenever the weather changes (a new hour, or the clouds switched). */
  subscribe(fn: () => void): void {
    this.listeners.push(fn);
  }
  private changed(): void {
    this.onChange();
    for (const fn of this.listeners) fn();
  }
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
    this.changed();
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
      this.changed();
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
      si.data[i + 3] = Math.min(0.3, p * 0.3) * 255;
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

  /** Cloud cover (0..1) at a tile, bilinear: like at(x, y).cloud, without the allocation (called per pixel). */
  cloudAt(tx: number, ty: number): number {
    if (OVERRIDE) return OVERRIDE.cloud;
    const d = this.data;
    if (!d) return 0;
    const fx = (tx / WORLD_W) * W - 0.5,
      fy = Math.min(H - 1, Math.max(0, (ty / WORLD_H) * H - 0.5));
    const x0 = Math.floor(fx),
      y0 = Math.floor(fy),
      ax = fx - x0,
      ay = fy - y0;
    const xa = (x0 + W) % W,
      xb = (x0 + 1 + W) % W,
      ra = y0 * W,
      rb = Math.min(H - 1, y0 + 1) * W;
    return ((d[(ra + xa) * 4] * (1 - ax) + d[(ra + xb) * 4] * ax) * (1 - ay) + (d[(rb + xa) * 4] * (1 - ax) + d[(rb + xb) * 4] * ax) * ay) / 255;
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

/** Cloud shadows: a tileable noise field, one point per half tile, drifting with the wind. */
const NOISE = 256;
const SHADOW_TILES_PER_PX = 0.5;
/** The shadows are worked out at one point per this many device pixels, then smoothed up to the screen. */
const SHADOW_STEP = 8;
/** Darkest a cloud shadow gets (alpha), in full daylight. */
const SHADOW_ALPHA = 0.3;
/** Drift in tiles per second: west to east, a little south (the westerlies, sped up so it shows). */
const DRIFT = { x: 0.45, y: 0.12 };

/** Tileable fractal value noise, 0..1, NOISE x NOISE. */
function cloudNoise(): Float32Array {
  const out = new Float32Array(NOISE * NOISE);
  let seed = 1234567;
  const rand = (): number => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32;
  let amp = 1,
    total = 0;
  for (const cells of [4, 8, 16, 32]) {
    const lattice = Float32Array.from({ length: cells * cells }, rand);
    const at = (i: number, j: number): number => lattice[(j % cells) * cells + (i % cells)];
    const step = NOISE / cells;
    for (let y = 0; y < NOISE; y++)
      for (let x = 0; x < NOISE; x++) {
        const fx = x / step,
          fy = y / step,
          i = Math.floor(fx),
          j = Math.floor(fy);
        const sx = (fx - i) * (fx - i) * (3 - 2 * (fx - i)),
          sy = (fy - j) * (fy - j) * (3 - 2 * (fy - j));
        const top = at(i, j) * (1 - sx) + at(i + 1, j) * sx,
          bottom = at(i, j + 1) * (1 - sx) + at(i + 1, j + 1) * sx;
        out[y * NOISE + x] += (top * (1 - sy) + bottom * sy) * amp;
      }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

export interface SkyView {
  isTileMode(): boolean;
  cam: { x: number; y: number };
  /** CSS px per tile */
  tilePx(): number;
  /** how dark it is (0..1) at a latitude and longitude */
  night: { levelAt(lat: number, lon: number): number };
}

/**
 * The weather over the zoomed-in view, on a canvas of its own over the map (animated only while there is something
 * to show, so the map itself is not redrawn every frame for it):
 *   cloud shadows  by day, drifting across the city: as much of the ground in shadow as the sky is covered where it
 *                  is, from scattered patches under a few clouds to nearly all of it under an overcast sky
 *   rain or snow   falling across the screen
 * From the weather at the camera.
 */
export class WeatherOverlay {
  private readonly canvas = document.createElement('canvas');
  private readonly g = this.canvas.getContext('2d')!;
  private drops: Drop[] = [];
  private running = false;
  private last = 0;
  private readonly t0 = performance.now();
  private readonly reduced = matchMedia('(prefers-reduced-motion: reduce)');
  private noise: Float32Array | null = null;
  /** noise value above which that share of the field is in shadow, per percent of cloud cover */
  private thresholds: Float32Array | null = null;
  private readonly low = document.createElement('canvas');
  private lowImg: ImageData | null = null;

  constructor(
    mapCanvas: HTMLCanvasElement,
    private readonly view: SkyView,
    private readonly weather: WeatherLayer,
  ) {
    Object.assign(this.canvas.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', pointerEvents: 'none' });
    this.canvas.setAttribute('aria-hidden', 'true');
    mapCanvas.after(this.canvas);
    // start as soon as there is something to show: when the weather arrives, when the view moves (callers poke()),
    // and once a second for what changes on its own (dusk and dawn)
    weather.subscribe(() => this.check());
    setInterval(() => this.check(), 1000);
    this.check();
  }

  /** What to draw now, or null (zoomed out, nothing to show, or reduced motion). `day` is the sunlight at the camera. */
  private sky(): { w: WeatherHere; day: number; shadows: boolean } | null {
    if (this.reduced.matches || document.hidden || !this.view.isTileMode()) return null;
    const { x, y } = this.view.cam;
    const w = this.weather.at(x, y);
    const day = 1 - this.view.night.levelAt(90 - (y / WORLD_H) * 180, (x / WORLD_W) * 360 - 180);
    // shadows anywhere on screen: cloud at the centre, a corner or an edge
    let shadows = false;
    if (day > 0.03 && this.weather.ready) {
      const half = (Math.max(innerWidth, innerHeight) / this.view.tilePx()) * 0.75;
      for (const [dx, dy] of [
        [0, 0],
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ])
        if (broken(this.weather.cloudAt(x + dx * half, y + dy * half)) > 0.01) {
          shadows = true;
          break;
        }
    }
    return w.precip >= 0.15 || shadows ? { w, day, shadows } : null;
  }

  /** The view moved or zoomed: start animating if there is now something to show. */
  poke(): void {
    this.check();
  }

  private check(): void {
    if (this.running || !this.sky()) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  private frame(now: number): void {
    const sky = this.sky();
    const dpr = devicePixelRatio || 1,
      cw = Math.round(innerWidth * dpr),
      ch = Math.round(innerHeight * dpr);
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    const g = this.g;
    g.clearRect(0, 0, cw, ch);
    if (!sky) {
      this.running = false;
      this.drops = [];
      return;
    }
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (sky.shadows) this.drawShadows(sky.day, now, dpr, cw, ch);
    if (sky.w.precip >= 0.15) this.drawPrecipitation(sky.w, dt, dpr, cw, ch);
    requestAnimationFrame((t) => this.frame(t));
  }

  /**
   * Cloud shadows over the screen. Each point looks up the cloud cover where it is (so shadows thin out towards clear
   * sky and close up under an overcast one, and panning never switches them all at once) and is in shadow where the
   * drifting noise field, anchored to the map, rises above the level that leaves that share of the ground shaded.
   */
  private drawShadows(day: number, now: number, dpr: number, cw: number, ch: number): void {
    const noise = (this.noise ??= cloudNoise());
    const thresholds = (this.thresholds ??= (() => {
      const sorted = Float32Array.from(noise).sort();
      return Float32Array.from({ length: 101 }, (_, p) => sorted[Math.min(sorted.length - 1, Math.floor((1 - p / 100) * sorted.length))]);
    })());
    const lw = Math.ceil(cw / SHADOW_STEP),
      lh = Math.ceil(ch / SHADOW_STEP);
    if (this.low.width !== lw || this.low.height !== lh || !this.lowImg) {
      this.low.width = lw;
      this.low.height = lh;
      this.lowImg = this.low.getContext('2d')!.createImageData(lw, lh);
      for (let i = 0; i < lw * lh; i++) {
        this.lowImg.data[i * 4] = 8;
        this.lowImg.data[i * 4 + 1] = 14;
        this.lowImg.data[i * 4 + 2] = 30;
      }
    }
    const px = this.lowImg.data;
    const secs = (now - this.t0) / 1000;
    const perTile = this.view.tilePx() * dpr,
      { x: camX, y: camY } = this.view.cam;
    const maxA = SHADOW_ALPHA * day * 255;
    for (let j = 0; j < lh; j++) {
      const ty = camY + ((j + 0.5) * SHADOW_STEP - ch / 2) / perTile;
      const v = (ty - DRIFT.y * secs) / SHADOW_TILES_PER_PX;
      const vj = Math.floor(v),
        fv = v - vj,
        r0 = (((vj % NOISE) + NOISE) % NOISE) * NOISE,
        r1 = ((((vj + 1) % NOISE) + NOISE) % NOISE) * NOISE;
      for (let i = 0; i < lw; i++) {
        const tx = camX + ((i + 0.5) * SHADOW_STEP - cw / 2) / perTile;
        const cover = this.weather.cloudAt(tx, ty);
        const b = broken(cover);
        let a = 0;
        if (b > 0.01) {
          const u = (tx - DRIFT.x * secs) / SHADOW_TILES_PER_PX;
          const ui = Math.floor(u),
            fu = u - ui,
            c0 = ((ui % NOISE) + NOISE) % NOISE,
            c1 = (c0 + 1) % NOISE;
          const n = (noise[r0 + c0] * (1 - fu) + noise[r0 + c1] * fu) * (1 - fv) + (noise[r1 + c0] * (1 - fu) + noise[r1 + c1] * fu) * fv;
          const t = thresholds[Math.round(cover * 100)];
          a = smooth(t - 0.05, t + 0.05, n) * b * maxA;
        }
        px[(j * lw + i) * 4 + 3] = a;
      }
    }
    this.low.getContext('2d')!.putImageData(this.lowImg, 0, 0);
    const g = this.g;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(this.low, 0, 0, lw * SHADOW_STEP, lh * SHADOW_STEP);
  }

  private drawPrecipitation(w: WeatherHere, dt: number, dpr: number, cw: number, ch: number): void {
    const g = this.g;
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

/** How strong the shadows are, 0..1: none under a nearly clear sky, full from a fifth of the sky covered (how much
 *  of the ground they cover is the cover itself, see drawShadows). */
const broken = (cover: number): number => smooth(0.08, 0.2, cover);

const smooth = (a: number, b: number, v: number): number => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
