// Generates the Moon (data/world-moon): 4096 x 2048 tiles, about 2.7 km each (the Earth's are 2.4 km), from real
// lunar data, all public domain:
//   - LRO LOLA elevation, 16 pixels per degree (PDS Geosciences Node, LDEM_16)
//   - Clementine UVVIS 750 nm albedo (USGS Astrogeology), read a row at a time: the 4 GB mosaic is raw bytes, so
//     only the 2048 rows the world needs are fetched (about 190 MB)
//   - IAU lunar nomenclature (USGS Gazetteer of Planetary Nomenclature): craters, maria and landing sites name the cities
// There is no water, no trees and no weather. The six biome slots are six shades of regolith (shared/src/biomeart.ts,
// the Moon's palettes): albedo (dark maria, bright highlands) times hillshade from the elevation, so craters show
// on the map and under the city. Run: npm run gen:moon -w tools
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { Biome, CHUNK, BASE_BIOME_MASK } from '@globalcity/shared';
import { writePngRgb } from './png.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RAW = resolve(ROOT, 'data/raw/moon');
const OUT = resolve(ROOT, 'data/world-moon');
const W = 4096,
  H = 2048;
const LDEM_URL = 'https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ldem_16.img';
const ALBEDO_URL = 'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Lunar_Clementine_UVVIS_750nm_Global_Mosaic_118m_v2.1.tif';
const NAMES_URL = 'https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/MOON_nomenclature_center_pts.kmz';

const t0 = Date.now();
const log = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);

async function download(url: string, file: string): Promise<void> {
  if (existsSync(file)) return;
  log(`downloading ${url}`);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  writeFileSync(file, Buffer.from(await r.arrayBuffer()));
}

/** LOLA elevation (m, relative to 1737.4 km) resampled to W x H, x from longitude -180. */
async function elevation(): Promise<Float32Array> {
  const file = resolve(RAW, 'ldem_16.img');
  await download(LDEM_URL, file);
  const SW = 5760,
    SH = 2880; // 16 px/degree, longitude 0..360 from column 0, latitude 90..-90
  const buf = readFileSync(file);
  if (buf.length !== SW * SH * 2) throw new Error(`ldem_16.img: ${buf.length} bytes, expected ${SW * SH * 2}`);
  const src = new Int16Array(buf.buffer, buf.byteOffset, SW * SH);
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const fy = ((y + 0.5) / H) * SH - 0.5,
      y0 = Math.max(0, Math.floor(fy)),
      y1 = Math.min(SH - 1, y0 + 1),
      ay = Math.min(1, Math.max(0, fy - y0));
    for (let x = 0; x < W; x++) {
      const lon = ((x + 0.5) / W) * 360 - 180;
      const fx = (((lon + 360) % 360) / 360) * SW - 0.5,
        x0 = (Math.floor(fx) + SW) % SW,
        x1 = (x0 + 1) % SW,
        ax = fx - Math.floor(fx);
      const v = (a: number, b: number) => src[a * SW + b] * 0.5;
      out[y * W + x] = (v(y0, x0) * (1 - ax) + v(y0, x1) * ax) * (1 - ay) + (v(y1, x0) * (1 - ax) + v(y1, x1) * ax) * ay;
    }
  }
  return out;
}

/** Clementine 750 nm albedo, 0..255 (0 = no data), W x H: one source row per world row, averaged across. */
async function albedo(): Promise<Uint8Array> {
  const file = resolve(RAW, `albedo_${W}x${H}.bin`);
  if (existsSync(file)) return new Uint8Array(readFileSync(file));
  const SW = 92160,
    SH = 46080,
    START = 738072; // raw bytes after the header (the mosaic's ISIS label: StartByte)
  const out = new Uint8Array(W * H);
  const step = SW / W;
  let done = 0;
  const row = async (y: number): Promise<void> => {
    const line = Math.min(SH - 1, Math.floor(((y + 0.5) / H) * SH));
    const from = START + line * SW;
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await fetch(ALBEDO_URL, { headers: { Range: `bytes=${from}-${from + SW - 1}` } });
        if (r.status !== 206) throw new Error(`HTTP ${r.status}`);
        const b = new Uint8Array(await r.arrayBuffer());
        if (b.length !== SW) throw new Error(`${b.length} bytes`);
        for (let x = 0; x < W; x++) {
          let s = 0,
            n = 0;
          for (let i = Math.floor(x * step); i < Math.floor((x + 1) * step); i++)
            if (b[i]) {
              s += b[i];
              n++;
            }
          out[y * W + x] = n ? Math.max(1, Math.round(s / n)) : 0;
        }
        break;
      } catch (e) {
        if (attempt >= 4) throw new Error(`albedo row ${y}: ${(e as Error).message}`, { cause: e });
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
    if (++done % 256 === 0) log(`albedo: ${done}/${H} rows`);
  };
  log(`reading the albedo mosaic a row at a time (${ALBEDO_URL})`);
  let next = 0;
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (next < H) await row(next++);
    }),
  );
  writeFileSync(file, out);
  return out;
}

/** Fill albedo gaps (0) from the nearest data along the row, then the column. */
function fillGaps(a: Uint8Array): Float32Array {
  const out = new Float32Array(W * H);
  let have = 0,
    sum = 0;
  for (let i = 0; i < a.length; i++)
    if (a[i]) {
      have++;
      sum += a[i];
    }
  const mean = have ? sum / have : 128;
  for (let y = 0; y < H; y++) {
    let last = -1;
    for (let x = 0; x < W; x++) {
      const v = a[y * W + x];
      out[y * W + x] = v || (last >= 0 ? last : mean);
      if (v) last = v;
    }
  }
  return out;
}

/** Box blur (radius r), wrapping east-west. */
function blur(src: Float32Array, r: number): Float32Array {
  const tmp = new Float32Array(W * H),
    out = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let d = -r; d <= r; d++) s += src[y * W + ((x + d + W) % W)];
      tmp[y * W + x] = s / (2 * r + 1);
    }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let s = 0,
        n = 0;
      for (let d = -r; d <= r; d++) {
        const yy = y + d;
        if (yy < 0 || yy >= H) continue;
        s += tmp[yy * W + x];
        n++;
      }
      out[y * W + x] = s / n;
    }
  return out;
}

/** Row y of `src` averaged over k tiles east-west (wrapping). */
function boxRow(src: Float32Array, y: number, k: number): Float32Array {
  const out = new Float32Array(W),
    r = k >> 1;
  for (let x = 0; x < W; x++) {
    let s = 0;
    for (let d = -r; d <= r; d++) s += src[y * W + ((x + d + W) % W)];
    out[x] = s / (2 * r + 1);
  }
  return out;
}

interface Place {
  name: string;
  x: number;
  y: number;
  pop: number;
  kind: string;
}

/** Named features from the IAU gazetteer: landing sites first, then maria, then craters and mountains by size. */
async function places(): Promise<Place[]> {
  const kmz = resolve(RAW, 'MOON_nomenclature_center_pts.kmz');
  await download(NAMES_URL, kmz);
  const kml = unzipFirst(readFileSync(kmz), /\.kml$/);
  const out: Place[] = [];
  const KINDS: Record<string, [string, number]> = {
    ST: ['Landing site', 5000], // statio: where a lander came down
    ME: ['Mare', 40],
    OC: ['Oceanus', 40],
    LC: ['Lacus', 30],
    SI: ['Sinus', 30],
    PA: ['Palus', 30],
    AA: ['Crater', 20],
    MO: ['Mons', 20],
    MS: ['Montes', 15],
    VA: ['Vallis', 10],
    RU: ['Rupes', 8],
    PR: ['Promontorium', 8],
  };
  for (const m of kml.matchAll(/<Placemark[\s\S]*?<\/Placemark>/g)) {
    const p = m[0];
    const f = (k: string) => p.match(new RegExp(`<SimpleData name="${k}">([^<]*)</SimpleData>`))?.[1] ?? '';
    const code = f('code'),
      kind = KINDS[code];
    if (!kind || !f('approval').startsWith('Adopted')) continue;
    const name = f('clean_name')
      .replace(/&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&');
    if (code === 'AA' && / [A-Z]{1,2}$/.test(name)) continue; // satellite craters ("Marco Polo P")
    const lon = ((Number(f('center_lon')) + 540) % 360) - 180,
      lat = Number(f('center_lat'));
    const d = Math.max(1, Number(f('diameter')) || 1);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    out.push({
      name,
      x: Math.min(W - 1, Math.floor(((lon + 180) / 360) * W)),
      y: Math.min(H - 1, Math.floor(((90 - lat) / 180) * H)),
      pop: Math.round(d * d * kind[1]),
      kind: kind[0],
    });
  }
  out.sort((a, b) => b.pop - a.pop);
  return out;
}

/** The first file in a zip whose name matches (stored or deflated): enough for a KMZ. */
function unzipFirst(zip: Buffer, name: RegExp): string {
  let o = 0;
  while (o + 30 <= zip.length && zip.readUInt32LE(o) === 0x04034b50) {
    const method = zip.readUInt16LE(o + 8),
      csize = zip.readUInt32LE(o + 18),
      nlen = zip.readUInt16LE(o + 26),
      xlen = zip.readUInt16LE(o + 28);
    const fname = zip.toString('utf8', o + 30, o + 30 + nlen);
    const data = zip.subarray(o + 30 + nlen + xlen, o + 30 + nlen + xlen + csize);
    if (name.test(fname)) return (method === 8 ? inflateRawSync(data) : data).toString('utf8');
    o += 30 + nlen + xlen + csize;
  }
  throw new Error(`no ${name} in the zip`);
}

/** Regolith shades from dark to bright, as biome slots: higher precedence (looks.ts) is brighter, so a bright
 *  tile's border frays into the darker one next to it. */
export const SHADE_BIOMES: readonly Biome[] = [Biome.Desert, Biome.Steppe, Biome.Temperate, Biome.Tundra, Biome.Boreal, Biome.Snow];

async function main(): Promise<void> {
  mkdirSync(RAW, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  const [elev, alb, named] = await Promise.all([elevation(), albedo(), places()]);
  log(`${named.length} named places`);

  // brightness: albedo, smoothed a little (the mosaic's seams), times a hillshade lit from the west at a low sun,
  // as on a classic lunar chart
  const a = blur(fillGaps(alb), 1);
  let lo = Infinity,
    hi = -Infinity;
  const sorted = Float32Array.from(a).sort();
  lo = sorted[Math.floor(sorted.length * 0.02)];
  hi = sorted[Math.floor(sorted.length * 0.98)];
  const TILE_M = (2 * Math.PI * 1737400) / W; // metres per tile east-west at the equator (and north-south)
  const EXAG = 3; // vertical exaggeration, so craters read at 2.7 km a tile
  const sun = { x: -0.75, y: -0.35, z: 0.56 }; // from the west-northwest, about 34 degrees up
  const sl = Math.hypot(sun.x, sun.y, sun.z);
  const bright = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const lat = 90 - ((y + 0.5) / H) * 180;
    // toward the poles a tile is narrower on the ground: take the east-west slope and albedo over as many tiles as
    // make the same distance, or the poles come out streaky
    const cos = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
    const k = Math.min(256, Math.max(1, Math.round(1 / cos)));
    const dx = TILE_M * cos * k;
    const row = k > 1 ? boxRow(a, y, k) : a.subarray(y * W, (y + 1) * W);
    for (let x = 0; x < W; x++) {
      const e = (xx: number, yy: number) => elev[Math.min(H - 1, Math.max(0, yy)) * W + ((xx + W) % W)];
      const gx = ((e(x + k, y) - e(x - k, y)) / (2 * dx)) * EXAG,
        gy = ((e(x, y + 1) - e(x, y - 1)) / (2 * TILE_M)) * EXAG;
      // normal (-gx, -gy, 1); y grows southward
      const nl = Math.hypot(gx, gy, 1);
      const lambert = (-gx * sun.x - gy * sun.y + sun.z) / (nl * sl);
      const shade = Math.max(0, lambert) / (sun.z / sl); // 1 on flat ground
      const alv = Math.min(1, Math.max(0, (row[x] - lo) / (hi - lo)));
      bright[y * W + x] = (0.25 + 0.75 * alv) * (0.55 + 0.45 * Math.min(1.6, shade));
    }
  }
  // six shades by quantiles, so each is used about as much (more at the middle)
  const bs = Float32Array.from(bright).sort();
  const cuts = [0.1, 0.25, 0.45, 0.68, 0.88].map((q) => bs[Math.floor(bs.length * q)]);
  const base = new Uint8Array(W * H);
  const counts = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < W * H; i++) {
    let k = 0;
    while (k < 5 && bright[i] > cuts[k]) k++;
    base[i] = SHADE_BIOMES[k] & BASE_BIOME_MASK;
    counts[k]++;
  }
  log(`shades (dark to bright): ${counts.map((c) => ((c / (W * H)) * 100).toFixed(1) + '%').join(' ')}`);

  const elevI = new Int16Array(W * H);
  for (let i = 0; i < W * H; i++) elevI[i] = Math.max(-32768, Math.min(32767, Math.round(elev[i])));
  // moonquakes can strike anywhere (they do: the Apollo seismometers felt them)
  const hazards = new Uint8Array((W / CHUNK) * (H / CHUNK)).fill(1 << 0);

  writeFileSync(resolve(OUT, 'base.bin'), base);
  writeFileSync(resolve(OUT, 'elevation.bin'), Buffer.from(elevI.buffer));
  writeFileSync(resolve(OUT, 'hazards.bin'), hazards);
  writeFileSync(
    resolve(OUT, 'places.json'),
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      source: NAMES_URL,
      places: named.map((p) => [p.name, p.x, p.y, p.pop, p.kind]),
    }),
  );
  writeFileSync(
    resolve(OUT, 'base.json'),
    JSON.stringify(
      {
        w: W,
        h: H,
        version: 2,
        planet: 'moon',
        layout: 'one byte per tile: bits 0-3 regolith shade (1 darkest, 2, 0, 3, 4, 5 brightest); no water, trees or ice',
        generatedAt: new Date().toISOString(),
        elevation: 'elevation.bin: Int16 little-endian per tile, metres relative to a 1737.4 km sphere (LOLA)',
        hazards: 'hazards.bin: moonquakes (earthquake, bit 0) everywhere',
        sources: [LDEM_URL, ALBEDO_URL, NAMES_URL],
      },
      null,
      2,
    ),
  );
  // preview, 2x2 tiles per pixel
  const S = 2,
    mw = W / S,
    mh = H / S,
    px = new Uint8Array(mw * mh * 4);
  for (let y = 0; y < mh; y++)
    for (let x = 0; x < mw; x++) {
      const k = SHADE_BIOMES.indexOf((base[y * S * W + x * S] & BASE_BIOME_MASK) as Biome);
      const g = 50 + k * 36,
        o = (y * mw + x) * 4;
      px[o] = px[o + 1] = px[o + 2] = g;
      px[o + 3] = 255;
    }
  writeFileSync(resolve(OUT, 'preview.png'), writePngRgb({ w: mw, h: mh, px }));
  log(`wrote ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
