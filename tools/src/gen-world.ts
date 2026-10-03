import { mkdirSync, existsSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORLD_W as W, WORLD_H as H } from '@globalcity/shared';
import { genPlaces } from './gen-places.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RAW = resolve(ROOT, 'data/raw');
const OUT = resolve(ROOT, 'data/world');
const PNG_OUT = resolve(ROOT, 'client/public/assets/world-minimap.png');
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
        if (!r.ok) { log(`  HTTP ${r.status}`); continue; }
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
  const ex0: number[] = [], ey0: number[] = [], ey1: number[] = [], slope: number[] = [];
  const next: number[] = [];
  const head = new Int32Array(H).fill(-1);
  for (const f of features) {
    for (const poly of polysOf(f.geometry)) {
      for (const ring of poly) {
        for (let i = 0; i < ring.length - 1; i++) {
          let x0 = px(ring[i][0]), y0 = py(ring[i][1]);
          let x1 = px(ring[i + 1][0]), y1 = py(ring[i + 1][1]);
          if (y0 === y1) continue;
          if (y0 > y1) { [x0, x1] = [x1, x0]; [y0, y1] = [y1, y0]; }
          // rows r where r+0.5 in [y0,y1)
          const r0 = Math.max(0, Math.ceil(y0 - 0.5));
          const r1 = Math.min(H - 1, Math.ceil(y1 - 0.5) - 1);
          if (r1 < r0) continue;
          const id = ex0.length;
          ex0.push(x0); ey0.push(y0); ey1.push(r1); slope.push((x1 - x0) / (y1 - y0));
          next.push(head[r0]); head[r0] = id;
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

function line(grid: Uint8Array, xa: number, ya: number, xb: number, yb: number, v: number) {
  let x0 = Math.floor(xa), y0 = Math.floor(ya);
  const x1 = Math.floor(xb), y1 = Math.floor(yb);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    if (x0 >= 0 && x0 < W && y0 >= 0 && y0 < H) grid[y0 * W + x0] = v;
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
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
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, seed), b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed), d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function fbm(x: number, y: number): number {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < 4; o++) {
    sum += amp * valueNoise(x * freq, y * freq, 1337 + o * 17);
    norm += amp; amp *= 0.5; freq *= 2;
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
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', new Uint8Array(0)),
  ]);
}

async function main() {
  const land = await getData('land', 'land');
  const lakes = await getData('lakes', 'lakes');
  const rivers = await getData('rivers_lake_centerlines', 'rivers');

  const grid = new Uint8Array(W * H);
  fillPolygons(grid, land.json.features, 1);
  log('land rasterized');
  fillPolygons(grid, lakes.json.features, 0);
  log('lakes rasterized');

  const props = rivers.json.features[0]?.properties ?? {};
  log(`river properties: ${Object.keys(props).join(',')}`);
  let nRivers = 0;
  for (const f of rivers.json.features) {
    const sr = f.properties?.scalerank;
    if (typeof sr === 'number' && sr > 6) continue;
    const g = f.geometry;
    const lines: number[][][] = g?.type === 'LineString' ? [g.coordinates] : g?.type === 'MultiLineString' ? g.coordinates : [];
    if (!lines.length) continue;
    nRivers++;
    for (const ls of lines)
      for (let i = 0; i < ls.length - 1; i++)
        line(grid, px(ls[i][0]), py(ls[i][1]), px(ls[i + 1][0]), py(ls[i + 1][1]), 0);
  }
  log(`rivers drawn: ${nRivers}`);

  // forest
  let landCount = 0, forestCount = 0;
  for (let y = 0; y < H; y++) {
    const lat = 90 - ((y + 0.5) / H) * 180;
    const alat = Math.abs(lat);
    const taper = (alat >= 75 || lat < -56) ? 0 : alat > 60 ? 1 - (alat - 60) / 15 : 1;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (grid[i] !== 1) continue;
      landCount++;
      if (taper <= 0) continue;
      const n = fbm(x / 90, y / 90);
      // shift threshold with taper: fewer trees at high latitude
      if (n + (1 - taper) * 0.25 > 0.56) { grid[i] = 2; forestCount++; }
    }
  }
  log('forest placed');

  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, 'base.bin'), grid);
  writeFileSync(resolve(OUT, 'base.json'), JSON.stringify({
    w: W, h: H, generatedAt: new Date().toISOString(), sources: [land.url, lakes.url, rivers.url],
  }, null, 2));

  // minimap 2048x1024, 4x4 tiles per pixel
  const S = 4, mw = W / S, mh = H / S;
  const cols = [[0, 0, 168], [138, 154, 74], [46, 106, 46]];
  const rgb = new Uint8Array(mw * mh * 3);
  for (let my = 0; my < mh; my++) for (let mx = 0; mx < mw; mx++) {
    let c0 = 0, c1 = 0, c2 = 0;
    for (let dy = 0; dy < S; dy++) {
      const row = (my * S + dy) * W + mx * S;
      for (let dx = 0; dx < S; dx++) { const v = grid[row + dx]; if (v === 0) c0++; else if (v === 1) c1++; else c2++; }
    }
    // land if any land majority, else water; forest if forest >= grass share among land
    const land = c1 + c2;
    const cls = land * 2 < S * S ? 0 : c2 > c1 ? 2 : 1;
    const o = (my * mw + mx) * 3;
    rgb[o] = cols[cls][0]; rgb[o + 1] = cols[cls][1]; rgb[o + 2] = cols[cls][2];
  }
  mkdirSync(dirname(PNG_OUT), { recursive: true });
  writeFileSync(PNG_OUT, encodePng(mw, mh, rgb));

  const kb = (p: string) => `${(statSync(p).size / 1024).toFixed(0)} KB`;
  console.log('--- summary ---');
  console.log(`land:   ${landCount} tiles (${((landCount / (W * H)) * 100).toFixed(2)}% of world)`);
  console.log(`forest: ${forestCount} tiles (${((forestCount / landCount) * 100).toFixed(2)}% of land)`);
  console.log(`elapsed: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`base.bin ${kb(resolve(OUT, 'base.bin'))}, base.json ${kb(resolve(OUT, 'base.json'))}, minimap ${kb(PNG_OUT)}`);
}
main().then(() => genPlaces()).catch((e) => { console.error(e); process.exit(1); });
