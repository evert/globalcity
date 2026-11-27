import './world-size.js';
import { mkdirSync, existsSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHUNK,
  CHUNKS_X,
  CHUNKS_Y,
  Disaster,
  hazardBit,
  inRegions,
  TORNADO_REGIONS,
  STORM_REGIONS,
  WORLD_TAG,
  WORLD_W as W,
  WORLD_H as H,
  Biome,
  BASE_WATER,
  BASE_FROZEN,
  BASE_TREES,
  BASE_BIOME_MASK,
} from '@globalcity/shared';
import { fromFile, type GeoTIFFImage } from 'geotiff';
import { genPlaces } from './gen-places.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RAW = resolve(ROOT, 'data/raw');
const OUT = resolve(ROOT, `data/world-${WORLD_TAG}`);
const BASE = 'https://raw.githubusercontent.com/martynafford/natural-earth-geojson/master';

const t0 = Date.now();
const log = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);

async function getData(name: string, kind: string): Promise<{ json: any; url: string }> {
  mkdirSync(RAW, { recursive: true });
  for (const res of ['10m', '50m']) {
    const file = resolve(RAW, `ne_${res}_${name}.json`);
    const url = `${BASE}/${res}/physical/ne_${res}_${name}.json`;
    try {
      if (!existsSync(file)) {
        log(`downloading ${url}`);
        const r = await fetch(url);
        if (!r.ok) {
          log(`  HTTP ${r.status}`);
          continue;
        }
        const text = await r.text();
        JSON.parse(text); // validate
        writeFileSync(file, text);
      }
      const json = JSON.parse(readFileSync(file, 'utf8'));
      log(`${kind}: using ${res} (${(statSync(file).size / 1e6).toFixed(1)} MB)`);
      return { json, url };
    } catch (e) {
      log(`  failed ${res}: ${(e as Error).message}`);
    }
  }
  throw new Error(`could not get ${name}`);
}

type Ring = number[][];
function polysOf(geom: any): Ring[][] {
  if (!geom) return [];
  if (geom.type === 'Polygon') return [geom.coordinates];
  if (geom.type === 'MultiPolygon') return geom.coordinates;
  return [];
}
const px = (lon: number) => ((lon + 180) / 360) * W;
const py = (lat: number) => ((90 - lat) / 180) * H;

/** Scanline fill with even-odd rule over all rings of the given features. value written to grid. */
function fillPolygons(grid: Uint8Array, features: any[], value: number) {
  // edge list bucketed by row: store edges as flat arrays with linked lists per start row
  const ex0: number[] = [],
    ey0: number[] = [],
    ey1: number[] = [],
    slope: number[] = [];
  const next: number[] = [];
  const head = new Int32Array(H).fill(-1);
  for (const f of features) {
    for (const poly of polysOf(f.geometry)) {
      for (const ring of poly) {
        for (let i = 0; i < ring.length - 1; i++) {
          let x0 = px(ring[i][0]),
            y0 = py(ring[i][1]);
          let x1 = px(ring[i + 1][0]),
            y1 = py(ring[i + 1][1]);
          if (y0 === y1) continue;
          if (y0 > y1) {
            [x0, x1] = [x1, x0];
            [y0, y1] = [y1, y0];
          }
          // rows r where r+0.5 in [y0,y1)
          const r0 = Math.max(0, Math.ceil(y0 - 0.5));
          const r1 = Math.min(H - 1, Math.ceil(y1 - 0.5) - 1);
          if (r1 < r0) continue;
          const id = ex0.length;
          ex0.push(x0);
          ey0.push(y0);
          ey1.push(r1);
          slope.push((x1 - x0) / (y1 - y0));
          next.push(head[r0]);
          head[r0] = id;
        }
      }
    }
  }
  let active: number[] = [];
  let xs: number[] = [];
  for (let r = 0; r < H; r++) {
    for (let e = head[r]; e !== -1; e = next[e]) active.push(e);
    if (active.length) {
      const yc = r + 0.5;
      xs.length = 0;
      const keep: number[] = [];
      for (const e of active) {
        xs.push(ex0[e] + (yc - ey0[e]) * slope[e]);
        if (ey1[e] > r) keep.push(e);
      }
      active = keep;
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const a = Math.max(0, Math.ceil(xs[i] - 0.5));
        const b = Math.min(W - 1, Math.ceil(xs[i + 1] - 0.5) - 1);
        if (b >= a) grid.fill(value, r * W + a, r * W + b + 1);
      }
    }
  }
}

/**
 * Draw a line `width` tiles wide (a width x width square stamped at every step), writing v over land only, so the
 * sea stays sea. Any width of 2 or more keeps the line joined through tile sides, never only through a corner:
 * shoreline smoothing looks at the four sides, so a corner-only join would draw as a break in the river.
 */
function line(grid: Uint8Array, xa: number, ya: number, xb: number, yb: number, v: number, width = 1) {
  let x0 = Math.floor(xa),
    y0 = Math.floor(ya);
  const x1 = Math.floor(xb),
    y1 = Math.floor(yb);
  const dx = Math.abs(x1 - x0),
    dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1,
    sy = y0 < y1 ? 1 : -1;
  const lo = -Math.floor((width - 1) / 2),
    hi = lo + width - 1;
  let err = dx + dy;
  for (;;) {
    for (let oy = lo; oy <= hi; oy++)
      for (let ox = lo; ox <= hi; ox++) {
        const x = x0 + ox,
          y = y0 + oy;
        if (x >= 0 && x < W && y >= 0 && y < H && grid[y * W + x] !== 0) grid[y * W + x] = v;
      }
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

// ---- noise ----
function hash(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x),
    iy = Math.floor(y);
  const fx = x - ix,
    fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx),
    sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, seed),
    b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed),
    d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function fbm(x: number, y: number, seed = 1337, octaves = 4): number {
  let amp = 1,
    freq = 1,
    sum = 0,
    norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + o * 17);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

// ---- PNG ----
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function encodePng(w: number, h: number, rgb: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

// ---- rasters (GeoTIFF, read in strips of output rows) ----
const KOPPEN_FILE = resolve(RAW, 'koppen/1991_2020/koppen_geiger_0p00833333.tif');
const KOPPEN_URL = 'https://figshare.com/articles/dataset/21789074 (koppen_geiger_tif.zip: 1991_2020/koppen_geiger_0p00833333.tif)';
const TREE_FILE = resolve(RAW, 'treecover/tree_cover_1km_2022.tif');
const TREE_URL = 'https://zenodo.org/records/14439377 (tree.cover_glc.fcd30d_p_1km_20220101_20221231_go_epsg4326_v20241210.tif)';
const ELEV_FILE = resolve(RAW, 'elevation/ETOPO_2022_v1_60s_N90W180_surface.tif');
const ELEV_URL = 'https://www.ngdc.noaa.gov/mgg/global/relief/ETOPO2022/data/60s/60s_surface_elev_gtif/ETOPO_2022_v1_60s_N90W180_surface.tif';
const PLATES_FILE = resolve(RAW, 'plates/PB2002_boundaries.json');
const PLATES_URL = 'https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_boundaries.json';
const SEAICE_DIR = resolve(RAW, 'seaice');
const SEAICE_URL = 'https://noaadata.apps.nsidc.org/NOAA/G02135/{north,south}/monthly/geotiff/ ({N,S}_YYYYMM_extent_v4.0.tif, 2015-2024)';
const SEAICE_YEARS = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024];

function need(file: string, how: string): void {
  if (!existsSync(file)) throw new Error(`missing ${file} (${how})\n  run tools/fetch-terrain-data.sh first`);
}

interface Raster {
  im: GeoTIFFImage;
  w: number;
  h: number;
  lon0: number;
  lat0: number;
  res: number;
  nodata: number;
}
async function openRaster(file: string): Promise<Raster> {
  const im = await (await fromFile(file)).getImage();
  const [lon0, lat0] = im.getOrigin();
  return { im, w: im.getWidth(), h: im.getHeight(), lon0, lat0, res: im.getResolution()[0], nodata: Number(im.getGDALNoData() ?? -1) };
}
/** Source rows [r0, r1) of a raster, full width. */
async function readRows(r: Raster, r0: number, r1: number): Promise<Uint8Array>;
async function readRows(r: Raster, r0: number, r1: number, float: true): Promise<Float32Array>;
async function readRows(r: Raster, r0: number, r1: number, _float?: boolean): Promise<Uint8Array | Float32Array> {
  r0 = Math.max(0, r0);
  r1 = Math.min(r.h, r1);
  if (r1 <= r0) return new Uint8Array(0);
  const [band] = (await r.im.readRasters({ window: [0, r0, r.w, r1] })) as unknown as Uint8Array[];
  return band;
}

// Koppen-Geiger classes (legend.txt of Beck et al. 2023) -> ground palette
const KOPPEN_BIOME: Biome[] = [];
for (let c = 0; c <= 30; c++) {
  KOPPEN_BIOME[c] =
    c === 4 || c === 5
      ? Biome.Desert
      : c === 6 || c === 7
        ? Biome.Steppe
        : [19, 20, 23, 24, 27, 28].includes(c)
          ? Biome.Boreal
          : c === 29
            ? Biome.Tundra
            : c === 30
              ? Biome.Snow
              : Biome.Temperate;
}
/** Climates where forests burn in dry seasons: savanna, steppe, Mediterranean, and the boreal forest. */
const DRY_FOREST_KOPPEN = new Set([3, 6, 7, 8, 9, 19, 20, 23, 24, 27, 28]);
/** Lakes and rivers in these climates are frozen for at least half of the year (subarctic, polar). */
const KOPPEN_FROZEN_INLAND = new Set([19, 20, 23, 24, 27, 28, 29, 30]);

// ---- sea ice: share of months with ice (extent >= 15% concentration), per 25 km cell of the NSIDC polar grids ----
interface IceGrid {
  w: number;
  h: number;
  x0: number;
  y0: number;
  freq: Float32Array;
  south: boolean;
}
async function loadSeaIce(south: boolean): Promise<IceGrid> {
  const P = south ? 'S' : 'N';
  let grid: IceGrid | null = null;
  let count: Uint16Array | null = null,
    n = 0;
  for (const y of SEAICE_YEARS)
    for (let m = 1; m <= 12; m++) {
      const f = resolve(SEAICE_DIR, `${P}_${y}${String(m).padStart(2, '0')}_extent_v4.0.tif`);
      need(f, SEAICE_URL);
      const im = await (await fromFile(f)).getImage();
      const [band] = (await im.readRasters()) as unknown as Uint8Array[];
      if (!grid) {
        const [x0, y0] = im.getOrigin();
        grid = { w: im.getWidth(), h: im.getHeight(), x0, y0, freq: new Float32Array(im.getWidth() * im.getHeight()), south };
        count = new Uint16Array(grid.freq.length);
        for (let i = 0; i < band.length; i++) if (band[i] >= 253) grid.freq[i] = -1; // coast / land
      }
      for (let i = 0; i < band.length; i++) if (band[i] === 1 || band[i] === 251) count![i]++; // 251: pole hole, always ice
      n++;
    }
  const g = grid!;
  for (let i = 0; i < g.freq.length; i++) if (g.freq[i] >= 0) g.freq[i] = count![i] / n;
  // spread ocean values into the coast/land cells, so fjords and inlets next to the coast get a value too
  for (let pass = 0; pass < 6; pass++) {
    const next = g.freq.slice();
    for (let y = 0; y < g.h; y++)
      for (let x = 0; x < g.w; x++) {
        const i = y * g.w + x;
        if (g.freq[i] >= 0) continue;
        let s = 0,
          k = 0;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const xx = x + dx,
            yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= g.w || yy >= g.h) continue;
          const v = g.freq[yy * g.w + xx];
          if (v >= 0) {
            s += v;
            k++;
          }
        }
        if (k) next[i] = s / k;
      }
    g.freq = next;
  }
  return g;
}
// NSIDC polar stereographic (EPSG:3411 north, lon0 -45; EPSG:3412 south, lon0 0), Hughes 1980 ellipsoid, true scale at 70 deg.
const D2R = Math.PI / 180;
const HUGHES_A = 6378273,
  HUGHES_E = 0.081816153;
const tsf = (phi: number) => Math.tan(Math.PI / 4 - phi / 2) / Math.pow((1 - HUGHES_E * Math.sin(phi)) / (1 + HUGHES_E * Math.sin(phi)), HUGHES_E / 2);
const PS_MC = Math.cos(70 * D2R) / Math.sqrt(1 - HUGHES_E * HUGHES_E * Math.sin(70 * D2R) ** 2);
const PS_TC = tsf(70 * D2R);
function polarStereo(lat: number, lon: number, south: boolean): [number, number] {
  let phi = lat * D2R,
    lam = lon * D2R;
  const lam0 = south ? 0 : -45 * D2R;
  if (south) {
    phi = -phi;
    lam = -lam;
  }
  const rho = (HUGHES_A * PS_MC * tsf(phi)) / PS_TC;
  const x = rho * Math.sin(lam - (south ? -lam0 : lam0)),
    y = -rho * Math.cos(lam - (south ? -lam0 : lam0));
  return south ? [-x, -y] : [x, y];
}
/** Share of the year (0..1) this ocean point is ice, bilinear over the 25 km grid; -1 if unknown. */
function iceAt(g: IceGrid, lat: number, lon: number): number {
  const [x, y] = polarStereo(lat, lon, g.south);
  const fx = (x - g.x0) / 25000 - 0.5,
    fy = (g.y0 - y) / 25000 - 0.5;
  const ix = Math.floor(fx),
    iy = Math.floor(fy),
    tx = fx - ix,
    ty = fy - iy;
  let s = 0,
    wsum = 0;
  for (const [dx, dy, w] of [
    [0, 0, (1 - tx) * (1 - ty)],
    [1, 0, tx * (1 - ty)],
    [0, 1, (1 - tx) * ty],
    [1, 1, tx * ty],
  ] as const) {
    const xx = ix + dx,
      yy = iy + dy;
    if (xx < 0 || yy < 0 || xx >= g.w || yy >= g.h) continue;
    const v = g.freq[yy * g.w + xx];
    if (v < 0) continue;
    s += v * w;
    wsum += w;
  }
  return wsum > 0 ? s / wsum : -1;
}

/** Spread noise to [0,1]: fbm clusters around 0.5, this stretches it to roughly uniform. */
const spread = (n: number, k: number): number => Math.min(1, Math.max(0, (n - 0.5) * k + 0.5));
const smoothstep = (a: number, b: number, v: number): number => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

async function main() {
  const land = await getData('land', 'land');
  const lakes = await getData('lakes', 'lakes');
  const rivers = await getData('rivers_lake_centerlines', 'rivers');
  const glaciers = await getData('glaciated_areas', 'glaciers');
  const shelves = await getData('antarctic_ice_shelves_polys', 'ice shelves');
  need(KOPPEN_FILE, KOPPEN_URL);
  need(TREE_FILE, TREE_URL);
  need(ELEV_FILE, ELEV_URL);
  need(PLATES_FILE, PLATES_URL);

  // 1. land / water: Natural Earth land plus the Antarctic ice shelves, minus lakes and major rivers
  const grid = new Uint8Array(W * H); // 0 sea, 1 land, 2 lake or river
  fillPolygons(grid, land.json.features, 1);
  fillPolygons(grid, shelves.json.features, 1);
  log('land rasterized');
  fillPolygons(grid, lakes.json.features, 2);
  log('lakes rasterized');
  let nRivers = 0;
  for (const f of rivers.json.features) {
    const sr = f.properties?.scalerank;
    if (typeof sr === 'number' && sr > 6) continue;
    const g = f.geometry;
    const lines: number[][][] = g?.type === 'LineString' ? [g.coordinates] : g?.type === 'MultiLineString' ? g.coordinates : [];
    if (!lines.length) continue;
    nRivers++;
    // the great rivers (scalerank 0-3: Danube, Nile, Volga, Ganges...) 3 tiles wide, the rest 2
    const width = typeof sr === 'number' && sr <= 3 ? 3 : 2;
    for (const ls of lines) for (let i = 0; i < ls.length - 1; i++) line(grid, px(ls[i][0]), py(ls[i][1]), px(ls[i + 1][0]), py(ls[i + 1][1]), 2, width);
  }
  log(`rivers drawn: ${nRivers}`);
  // 2. ice: glaciers and ice shelves are snow-covered land
  const ice = new Uint8Array(W * H);
  fillPolygons(ice, glaciers.json.features, 1);
  fillPolygons(ice, shelves.json.features, 1);
  log('glaciers rasterized');

  const iceN = await loadSeaIce(false),
    iceS = await loadSeaIce(true);
  log('sea ice loaded');

  // 3. per strip of rows: climate (Koppen, sampled at a noise-jittered point so borders wiggle like real
  // ones instead of following the 1 km raster), tree cover (box average), sea ice
  const kop = await openRaster(KOPPEN_FILE),
    tree = await openRaster(TREE_FILE),
    etopo = await openRaster(ELEV_FILE);
  // elevation of every tile, metres above sea level (negative: the sea floor), from ETOPO 2022 at the tile centre
  const elev = new Int16Array(W * H);
  const ept = etopo.w / W; // source px per tile
  // per chunk, for hazards: forest in fire-prone climates, land with cold winters
  const dryForest = new Uint32Array(CHUNKS_X * CHUNKS_Y),
    coldLand = new Uint32Array(CHUNKS_X * CHUNKS_Y);
  const out = new Uint8Array(W * H);
  const STRIP = 128,
    JIT = 6; // rows per strip, max jitter in tiles
  const kpt = kop.w / W; // source px per tile (both rasters are 1/120 degree)
  const stats = new Float64Array(16);
  let shownPct = 0; // progress is logged every 10% of the rows
  for (let y0 = 0; y0 < H; y0 += STRIP) {
    const y1 = Math.min(H, y0 + STRIP);
    const kr0 = Math.floor((y0 - JIT) * kpt) - 1,
      kr1 = Math.ceil((y1 + JIT) * kpt) + 1;
    const kRows = await readRows(kop, kr0, kr1),
      kBase = Math.max(0, kr0);
    const lat0 = 90 - (y0 / H) * 180,
      lat1 = 90 - (y1 / H) * 180;
    const tr0 = Math.floor((tree.lat0 - lat0) / tree.res),
      tr1 = Math.ceil((tree.lat0 - lat1) / tree.res);
    const tRows = await readRows(tree, tr0, tr1),
      tBase = Math.max(0, tr0);
    const tRowsN = tRows.length / tree.w;
    const er0 = Math.floor(y0 * ept),
      er1 = Math.ceil(y1 * ept) + 1;
    const eRows = await readRows(etopo, er0, er1, true),
      eBase = Math.max(0, er0);
    for (let y = y0; y < y1; y++) {
      const lat = 90 - ((y + 0.5) / H) * 180;
      const eRow = Math.min(eRows.length / etopo.w - 1, Math.floor((y + 0.5) * ept) - eBase) * etopo.w;
      for (let x = 0; x < W; x++) {
        const e = eRows[eRow + Math.min(etopo.w - 1, Math.floor((x + 0.5) * ept))];
        elev[y * W + x] = e > -99000 ? Math.max(-32768, Math.min(32767, Math.round(e))) : 0;
      }
      // tree source rows for this tile row
      const ta = Math.floor((tree.lat0 - (90 - (y / H) * 180)) / tree.res) - tBase;
      const tb = Math.max(ta + 1, Math.floor((tree.lat0 - (90 - ((y + 1) / H) * 180)) / tree.res) - tBase);
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const isLand = grid[i] === 1;
        // climate
        const jx = (fbm(x / 28, y / 28, 911, 3) - 0.5) * 2 * JIT,
          jy = (fbm(x / 28, y / 28, 577, 3) - 0.5) * 2 * JIT;
        const kx = Math.min(kop.w - 1, Math.max(0, Math.floor(((x + 0.5 + jx + W) % W) * kpt)));
        const ky = Math.min(kRows.length / kop.w - 1, Math.max(0, Math.floor((y + 0.5 + jy) * kpt) - kBase));
        const kAt = (tx: number, ty: number): number => {
          const sx = Math.min(kop.w - 1, Math.max(0, Math.floor(((tx + 0.5 + W) % W) * kpt)));
          const sy = Math.min(kRows.length / kop.w - 1, Math.max(0, Math.floor((ty + 0.5) * kpt) - kBase));
          const v = kRows[sy * kop.w + sx];
          return v > 30 ? 0 : v;
        };
        let k = kRows[ky * kop.w + kx];
        if (k > 30) k = 0;
        // land the climate map calls sea (the coastlines differ a little): borrow the nearest climate
        if (k === 0 && isLand) {
          k = kAt(x, y);
          for (let r = 1; k === 0 && r <= JIT; r++) {
            for (const [dx, dy] of [
              [r, 0],
              [-r, 0],
              [0, r],
              [0, -r],
              [r, r],
              [-r, r],
              [r, -r],
              [-r, -r],
            ]) {
              k = kAt(x + dx, y + dy);
              if (k) break;
            }
          }
        }
        if (!isLand) {
          let frozen: boolean;
          if (k !== 0) frozen = KOPPEN_FROZEN_INLAND.has(k) || ice[i] === 1; // lake or river
          else if (Math.abs(lat) < 38) frozen = false;
          else {
            const f = iceAt(lat > 0 ? iceN : iceS, lat, ((x + 0.5) / W) * 360 - 180);
            frozen = f >= 0 ? f + (fbm(x / 20, y / 20, 4242, 3) - 0.5) * 0.25 >= 0.5 : Math.abs(lat) > 80;
          }
          out[i] = BASE_WATER | (frozen ? BASE_FROZEN : 0);
          stats[frozen ? 1 : 0]++;
          continue;
        }
        let biome = k === 0 ? (Math.abs(lat) > 64 ? Biome.Tundra : Biome.Temperate) : KOPPEN_BIOME[k];
        if (ice[i] === 1) biome = Biome.Snow;
        // forest: real tree cover decides how likely a tile is wooded; clumpy noise decides which ones
        let cover = 0;
        if (tRowsN > 0 && biome !== Biome.Snow) {
          const lon0 = (x / W) * 360 - 180;
          const ca = Math.floor((lon0 - tree.lon0) / tree.res),
            cb = Math.max(ca + 1, Math.floor((lon0 + 360 / W - tree.lon0) / tree.res));
          let s = 0,
            nPx = 0;
          for (let r = Math.max(0, ta); r < Math.min(tRowsN, tb); r++) {
            const row = r * tree.w;
            for (let c = ca; c < cb; c++) {
              const v = tRows[row + ((c + tree.w) % tree.w)];
              if (v <= 100) {
                s += v;
                nPx++;
              }
            }
          }
          if (nPx) cover = s / nPx / 100;
        }
        const pForest = smoothstep(0.1, 0.55, cover);
        const n = spread(fbm(x / 16, y / 16, 1337, 4), 2.6);
        const forest = pForest > 0 && n < pForest;
        out[i] = biome | (forest ? BASE_TREES : 0);
        const ci = (y >> 6) * CHUNKS_X + (x >> 6);
        if (forest && DRY_FOREST_KOPPEN.has(k)) dryForest[ci]++;
        if ((k >= 17 && k <= 30) || biome === Biome.Snow) coldLand[ci]++;
        stats[2 + biome]++;
        if (forest) stats[10]++;
      }
    }
    const pct = Math.floor((y1 / H) * 10) * 10;
    if (pct > shownPct) {
      shownPct = pct;
      log(`climate/forest/ice ${pct}%`);
    }
  }
  // 4. water tiles take the ground of the land beside them (most common among the four sides), so shore pieces,
  // which draw a strip of that land, match it. Water with no land beside it keeps the default; it never shows.
  {
    const counts = new Uint8Array(16);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!(out[i] & BASE_WATER)) continue;
        counts.fill(0);
        let any = false;
        for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
          if (j < 0 || out[j] & BASE_WATER) continue;
          counts[out[j] & BASE_BIOME_MASK]++;
          any = true;
        }
        if (!any) continue;
        let best = 0;
        for (let b = 1; b < 16; b++) if (counts[b] > counts[best]) best = b;
        out[i] = (out[i] & ~BASE_BIOME_MASK) | best;
      }
  }
  log('shore biomes');

  // 5. hazards: which disasters can strike each chunk (shared/src/disasters.ts)
  const hazards = new Uint8Array(CHUNKS_X * CHUNKS_Y);
  {
    // earthquakes: within about a chunk of a plate boundary (Bird's PB2002 model)
    const near = new Uint8Array(CHUNKS_X * CHUNKS_Y);
    const plates = JSON.parse(readFileSync(PLATES_FILE, 'utf8'));
    for (const f of plates.features) {
      const g = f.geometry;
      const lines: number[][][] = g?.type === 'LineString' ? [g.coordinates] : g?.type === 'MultiLineString' ? g.coordinates : [];
      for (const ls of lines)
        for (let i = 0; i + 1 < ls.length; i++) {
          const [lon0, lat0] = ls[i],
            [lon1, lat1] = ls[i + 1];
          if (Math.abs(lon1 - lon0) > 180) continue; // crosses the date line
          const n = Math.ceil(Math.max(Math.abs(lon1 - lon0), Math.abs(lat1 - lat0)) / 0.5) + 1;
          for (let k = 0; k <= n; k++) {
            const lon = lon0 + ((lon1 - lon0) * k) / n,
              lat = lat0 + ((lat1 - lat0) * k) / n;
            const cx = Math.floor(px(lon) / CHUNK),
              cy = Math.floor(py(lat) / CHUNK);
            if (cx >= 0 && cy >= 0 && cx < CHUNKS_X && cy < CHUNKS_Y) near[cy * CHUNKS_X + cx] = 1;
          }
        }
    }
    const counts = new Array(6).fill(0);
    for (let cy = 0; cy < CHUNKS_Y; cy++)
      for (let cx = 0; cx < CHUNKS_X; cx++) {
        const ci = cy * CHUNKS_X + cx;
        let land = 0,
          low = 0,
          coast = 0;
        for (let y = cy * CHUNK; y < cy * CHUNK + CHUNK; y++)
          for (let x = cx * CHUNK; x < cx * CHUNK + CHUNK; x++) {
            const i = y * W + x;
            if (grid[i] !== 1) continue;
            land++;
            const seaSide =
              (x > 0 && grid[i - 1] === 0) || (x < W - 1 && grid[i + 1] === 0) || (y > 0 && grid[i - W] === 0) || (y < H - 1 && grid[i + W] === 0);
            if (seaSide) coast++;
            if (elev[i] > 8) continue;
            // low land within two tiles of water (sea, lake or river)
            let wet = false;
            for (let dy = -2; dy <= 2 && !wet; dy++)
              for (let dx = -2; dx <= 2; dx++) {
                const xx = x + dx,
                  yy = y + dy;
                if (xx >= 0 && yy >= 0 && xx < W && yy < H && grid[yy * W + xx] !== 1) {
                  wet = true;
                  break;
                }
              }
            if (wet) low++;
          }
        if (land < 64) continue;
        const lat = 90 - (((cy + 0.5) * CHUNK) / H) * 180,
          lon = (((cx + 0.5) * CHUNK) / W) * 360 - 180;
        let h = 0;
        let quake = false;
        for (let dy = -1; dy <= 1 && !quake; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = (cx + dx + CHUNKS_X) % CHUNKS_X,
              yy = cy + dy;
            if (yy >= 0 && yy < CHUNKS_Y && near[yy * CHUNKS_X + xx]) {
              quake = true;
              break;
            }
          }
        if (quake) h |= hazardBit(Disaster.Earthquake);
        if (low >= 150) h |= hazardBit(Disaster.Flood);
        if (inRegions(TORNADO_REGIONS, lat, lon)) h |= hazardBit(Disaster.Tornado);
        if (coast >= 16 && inRegions(STORM_REGIONS, lat, lon)) h |= hazardBit(Disaster.Storm);
        if (dryForest[ci] >= 200) h |= hazardBit(Disaster.Wildfire);
        if (coldLand[ci] >= land / 2) h |= hazardBit(Disaster.Blizzard);
        hazards[ci] = h;
        for (let d = 0; d < 6; d++) if (h & (1 << d)) counts[d]++;
      }
    log(
      `hazards (chunks): earthquake ${counts[0]}, flood ${counts[1]}, tornado ${counts[2]}, storm ${counts[3]}, wildfire ${counts[4]}, blizzard ${counts[5]}`,
    );
  }

  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, 'elevation.bin'), Buffer.from(elev.buffer));
  writeFileSync(resolve(OUT, 'hazards.bin'), hazards);
  writeFileSync(resolve(OUT, 'base.bin'), out);
  writeFileSync(
    resolve(OUT, 'base.json'),
    JSON.stringify(
      {
        w: W,
        h: H,
        version: 2,
        layout: 'one byte per tile: bits 0-3 biome (0 temperate, 1 desert, 2 steppe, 3 tundra, 4 boreal, 5 snow), 0x20 trees, 0x40 frozen, 0x80 water',
        generatedAt: new Date().toISOString(),
        elevation: 'elevation.bin: Int16 little-endian per tile, metres above sea level (negative below), ETOPO 2022 surface',
        hazards: `hazards.bin: one byte per chunk (row-major ${CHUNKS_X}x${CHUNKS_Y}), bit d set = Disaster d possible there (shared/src/disasters.ts)`,
        sources: [land.url, lakes.url, rivers.url, glaciers.url, shelves.url, KOPPEN_URL, TREE_URL, SEAICE_URL, ELEV_URL, PLATES_URL],
      },
      null,
      2,
    ),
  );

  // preview, 4x4 tiles per pixel: the most common kind wins
  const S = 4,
    mw = W / S,
    mh = H / S;
  const rgb = new Uint8Array(mw * mh * 3);
  const PAL: Record<string, [number, number, number]> = {
    water: [0x66, 0x66, 0xe6],
    ice: [0xd8, 0xe8, 0xf4],
    g0: [0xcc, 0x7f, 0x66],
    g1: [0xe6, 0xc8, 0x8c],
    g2: [0xc4, 0xb0, 0x70],
    g3: [0x9c, 0x9c, 0x84],
    g4: [0xc8, 0xc8, 0xc8],
    g5: [0xff, 0xff, 0xff],
    t0: [0x00, 0xb8, 0x00],
    t1: [0x70, 0x90, 0x30],
    t2: [0x60, 0x98, 0x30],
    t3: [0x40, 0x80, 0x40],
    t4: [0x1c, 0x60, 0x3c],
    t5: [0x1c, 0x60, 0x3c],
  };
  const counts = new Map<string, number>();
  for (let my = 0; my < mh; my++)
    for (let mx = 0; mx < mw; mx++) {
      counts.clear();
      for (let dy = 0; dy < S; dy++)
        for (let dx = 0; dx < S; dx++) {
          const b = out[(my * S + dy) * W + mx * S + dx];
          const key = b & BASE_WATER ? (b & BASE_FROZEN ? 'ice' : 'water') : (b & BASE_TREES ? 't' : 'g') + (b & BASE_BIOME_MASK);
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      let best = 'water',
        bn = -1;
      for (const [k, v] of counts)
        if (v > bn) {
          best = k;
          bn = v;
        }
      const c = PAL[best],
        o = (my * mw + mx) * 3;
      rgb[o] = c[0];
      rgb[o + 1] = c[1];
      rgb[o + 2] = c[2];
    }
  writeFileSync(resolve(OUT, 'preview.png'), encodePng(mw, mh, rgb));

  const landCount = stats.slice(2, 8).reduce((a, b) => a + b, 0);
  const pct = (v: number, of: number) => `${((v / of) * 100).toFixed(1)}%`;
  console.log('--- summary ---');
  console.log(`land:   ${landCount} tiles (${pct(landCount, W * H)} of world), forest ${pct(stats[10], landCount)} of land`);
  console.log(`biomes: ${['temperate', 'desert', 'steppe', 'tundra', 'boreal', 'snow'].map((n, b) => `${n} ${pct(stats[2 + b], landCount)}`).join(', ')}`);
  console.log(`water:  ${stats[0] + stats[1]} tiles, frozen ${pct(stats[1], stats[0] + stats[1])}`);
  console.log(`elapsed: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
main()
  .then(() => genPlaces())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
