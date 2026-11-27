// Real weather for the map: clouds, rain and snow from NOAA's GFS forecast model, the hour closest to now.
// GFS runs four times a day and publishes each run as public files on AWS (the NOAA Open Data Dissemination bucket,
// made for bulk downloads, no key, public domain). Each file has an index, so only the three fields used are fetched,
// by byte range: about 2 MB an hour, whoever is playing. They are decoded here (grib.ts) into a 0.25-degree grid and
// served as one small PNG (0.5 degrees) (GET /api/weather) that every client draws over the map; GET /api/weather.json says which
// hour it is, so clients only download a new image when the hour changes.
//   red    cloud cover, 0-100% as 0-255
//   green  precipitation, sqrt of the rate (0 to 10+ mm/h as 0-255), so light rain still shows; any rain at all is at least 8
//   blue   255 where it falls as snow
import type http from 'node:http';
import { decodeGrib2, type GribField } from './grib.ts';
import { encodeRgbPng } from './png.ts';
import { log, warn } from './util.ts';

const BUCKET = 'https://noaa-gfs-bdp-pds.s3.amazonaws.com';
/** the grid sent to clients: 0.5 degrees (2x2 GFS points each), west edge at 180 W, top row at 90 N */
export const WEATHER_W = 720,
  WEATHER_H = 360;
/** values are rounded to this step, so the image compresses well (the client smooths it anyway) */
const STEP = 8;
/** How often to look for a newer hour. Each hour's fields are fetched once. */
const CHECK_MS = 10 * 60_000;
const HOUR = 3_600_000,
  CYCLE = 6 * HOUR;
/** Rain rate (mm/h) that fills the green channel. */
const HEAVY_MM_H = 10;

interface Target {
  cycle: number; // run time, epoch ms
  fhour: number;
}

export interface WeatherInfo {
  /** the hour the weather is for, epoch ms (null until the first fetch) */
  valid: number | null;
  /** the forecast run it came from */
  run: string | null;
  source: string;
}

const pad = (n: number, w: number): string => String(n).padStart(w, '0');
function fileUrl(t: Target): string {
  const d = new Date(t.cycle);
  const ymd = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1, 2)}${pad(d.getUTCDate(), 2)}`,
    hh = pad(d.getUTCHours(), 2);
  return `${BUCKET}/gfs.${ymd}/${hh}/atmos/gfs.t${hh}z.pgrb2.0p25.f${pad(t.fhour, 3)}`;
}

async function get(url: string, range?: [number, number]): Promise<Response> {
  const res = await fetch(url, {
    headers: { 'user-agent': 'GlobalCity weather', ...(range ? { range: `bytes=${range[0]}-${range[1]}` } : {}) },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} for ${url}`), { status: res.status });
  return res;
}

/** The byte range of each wanted field in a GFS file, from its .idx (lines: n:offset:date:VAR:level:time:). */
function rangesOf(idx: string, wanted: string[]): Map<string, [number, number]> {
  const lines = idx.trim().split('\n');
  const out = new Map<string, [number, number]>();
  lines.forEach((line, i) => {
    const parts = line.split(':');
    const key = `${parts[3]}:${parts[4]}:${parts[5]}`;
    if (!wanted.includes(key)) return;
    const start = Number(parts[1]);
    const end = i + 1 < lines.length ? Number(lines[i + 1].split(':')[1]) - 1 : -1;
    if (end < 0) throw new Error(`${key} is the last field in the index: its length is unknown`);
    out.set(key, [start, end]);
  });
  return out;
}

export class Weather {
  private png: Buffer | null = null;
  private current: Target | null = null;
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  /** Fetch the current hour now and keep it current. */
  start(): void {
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), CHECK_MS);
    this.timer.unref();
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  info(): WeatherInfo {
    const t = this.current;
    return {
      valid: t ? t.cycle + t.fhour * HOUR : null,
      run: t ? `${new Date(t.cycle).toISOString().slice(0, 13)}Z f${pad(t.fhour, 3)}` : null,
      source: 'NOAA GFS 0.25 degree (public domain), via the NOAA Open Data Dissemination program on AWS',
    };
  }

  /** The newest run that has the hour closest to now, newest first: this run, then up to two before it. */
  private candidates(now: number): Target[] {
    const latest = Math.floor(now / CYCLE) * CYCLE;
    const out: Target[] = [];
    for (let k = 0; k < 3; k++) {
      const cycle = latest - k * CYCLE;
      out.push({ cycle, fhour: Math.min(120, Math.max(1, Math.round((now - cycle) / HOUR))) });
    }
    return out;
  }

  async refresh(now = Date.now()): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      for (const t of this.candidates(now)) {
        const valid = t.cycle + t.fhour * HOUR;
        // already showing this hour, or a newer run of it
        if (this.current && this.current.cycle + this.current.fhour * HOUR === valid && this.current.cycle >= t.cycle) return;
        try {
          await this.load(t);
          return;
        } catch (e) {
          if ((e as { status?: number }).status === 404 || (e as { status?: number }).status === 403) continue; // run not published yet
          throw e;
        }
      }
      warn('weather: no GFS run found for the current hour');
    } catch (e) {
      warn(`weather: ${(e as Error).message} (keeping the previous hour)`);
    } finally {
      this.busy = false;
    }
  }

  private async load(t: Target): Promise<void> {
    const t0 = Date.now();
    const url = fileUrl(t);
    const h = `${t.fhour} hour fcst`;
    const keys = { cloud: `TCDC:entire atmosphere:${h}`, rate: `PRATE:surface:${h}`, snow: `CSNOW:surface:${h}` };
    const ranges = rangesOf(await (await get(`${url}.idx`)).text(), Object.values(keys));
    const field = async (key: string): Promise<GribField> => {
      const r = ranges.get(key);
      if (!r) throw new Error(`${key} missing from ${url}.idx`);
      return decodeGrib2(new Uint8Array(await (await get(url, r)).arrayBuffer()));
    };
    const [cloud, rate, snow] = await Promise.all([field(keys.cloud), field(keys.rate), field(keys.snow)]);
    const fetched = Date.now() - t0;
    this.png = encodeRgbPng(WEATHER_W, WEATHER_H, toGrid(cloud, rate, snow));
    this.current = t;
    log(
      `weather: ${this.info().run} (${fetched} ms to fetch and decode, ${Date.now() - t0 - fetched} ms to encode, ${(this.png.length / 1024).toFixed(0)} KB)`,
    );
  }

  /** GET /api/weather (the grid as a PNG) and /api/weather.json (which hour it is). */
  handle(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): boolean {
    if (pathname !== '/api/weather' && pathname !== '/api/weather.json') return false;
    if (pathname === '/api/weather.json') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' });
      res.end(JSON.stringify(this.info()));
      return true;
    }
    if (!this.png) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('no weather yet');
      return true;
    }
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': this.png.length, 'cache-control': 'public, max-age=300' });
    res.end(req.method === 'HEAD' ? undefined : this.png);
    return true;
  }
}

/** The three GFS fields as the client's grid: 2x2 points averaged (snow where most of them have it), rotated so it
 *  starts at 180 W; GFS's last row (90 S) is left out. */
export function toGrid(cloud: GribField, rate: GribField, snow: GribField): Uint8Array {
  const NI = WEATHER_W * 2;
  for (const f of [cloud, rate, snow])
    if (f.ni !== NI || f.nj < WEATHER_H * 2 || f.lat0 !== 90 || f.dj >= 0 || Math.abs(f.lon0) > 1e-6)
      throw new Error(`unexpected GFS grid ${f.ni}x${f.nj} from ${f.lat0},${f.lon0}`);
  const ok = (v: number): number => (Number.isFinite(v) ? v : 0);
  const q = (v: number): number => Math.min(255, Math.round(v / STEP) * STEP);
  const rgb = new Uint8Array(WEATHER_W * WEATHER_H * 3);
  for (let y = 0; y < WEATHER_H; y++)
    for (let x = 0; x < WEATHER_W; x++) {
      let c = 0,
        mmh = 0,
        s = 0;
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) {
          const i = (y * 2 + dy) * NI + ((x * 2 + dx + NI / 2) % NI);
          c += ok(cloud.values[i]);
          mmh += Math.max(0, ok(rate.values[i])) * 3600;
          s += snow.values[i] > 0.5 ? 1 : 0;
        }
      const o = (y * WEATHER_W + x) * 3;
      rgb[o] = q((Math.min(100, Math.max(0, c / 4)) * 255) / 100);
      rgb[o + 1] = mmh > 0 ? Math.max(STEP, q(Math.sqrt(Math.min(1, mmh / 4 / HEAVY_MM_H)) * 255)) : 0;
      rgb[o + 2] = s >= 2 ? 255 : 0;
    }
  return rgb;
}
