// A founding (first) plot needs MIN_LAND_TILES_FIRST_CLAIM land tiles; an extra, adjacent plot only
// MIN_LAND_TILES_TO_CLAIM, so a coastal strip next to your city can still be bought.
//  - a new mayor's claim on a mostly-water plot is refused, and the message says how much land is needed
//  - findFree from there answers a plot that meets the founding rule, and claiming it works
//  - once they own a plot, the same mostly-water plot (adjacent) can be bought
// Candidates come from data/world-<W>x<H>/base.bin (a terrain byte per tile; BASE_WATER marks water); the land counts are re-checked on the live tiles the server sends.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import {
  decodeChunk, chunkLandCount, MIN_LAND_TILES_FIRST_CLAIM, MIN_LAND_TILES_TO_CLAIM, WORLD_W, WORLD_H, CHUNK,
  CHUNKS_X, CHUNKS_Y, WORLD_TAG, BASE_WATER,
} from '@globalcity/shared';

const URL = `ws://127.0.0.1:${process.env.PORT}/ws`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => { console.log('FAIL:', m); process.exit(1); };
async function waitFor(fn, what, ms = 5000) {
  const t0 = Date.now();
  for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) fail(`timed out waiting for ${what}`); await sleep(20); }
}

// ---- candidates: a mostly-water plot (enough land for an extra plot, not for a first) next to a plot with plenty ----
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const baseFile = path.join(root, `data/world-${WORLD_TAG}/base.bin`);
const base = fs.readFileSync(baseFile);
if (base.length !== WORLD_W * WORLD_H) fail(`needs the generated world in ${baseFile}`);
const land = new Int32Array(CHUNKS_X * CHUNKS_Y);
for (let cy = 0; cy < CHUNKS_Y; cy++) for (let cx = 0; cx < CHUNKS_X; cx++) {
  let n = 0;
  for (let y = 0; y < CHUNK; y++) { const o = (cy * CHUNK + y) * WORLD_W + cx * CHUNK; for (let x = 0; x < CHUNK; x++) if (!(base[o + x] & BASE_WATER)) n++; }
  land[cy * CHUNKS_X + cx] = n;
}
const pairs = [];
for (let cy = 1; cy < CHUNKS_Y - 1 && pairs.length < 5; cy++) for (let cx = 1; cx < CHUNKS_X - 1 && pairs.length < 5; cx++) {
  const n = land[cy * CHUNKS_X + cx];
  if (n < MIN_LAND_TILES_TO_CLAIM * 4 || n >= MIN_LAND_TILES_FIRST_CLAIM / 2) continue; // clearly in between
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (land[(cy + dy) * CHUNKS_X + cx + dx] >= MIN_LAND_TILES_FIRST_CLAIM * 2) { pairs.push({ small: { cx, cy }, big: { cx: cx + dx, cy: cy + dy } }); break; }
  }
}
if (!pairs.length) fail('no mostly-water plot next to a plot with plenty of land in base.bin');

// ---- client ----
const ws = new WebSocket(URL); ws.binaryType = 'arraybuffer';
let me = null, spot = null; const chunks = new Map(); const toasts = []; const claims = [];
ws.on('message', (d, bin) => {
  if (bin) { const f = decodeChunk(d instanceof ArrayBuffer ? d : d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength)); if (f) chunks.set(`${f.cx},${f.cy}`, f.tiles); return; }
  const m = JSON.parse(d.toString());
  if (m.t === 'welcome') me = m.player;
  else if (m.t === 'freeSpot') spot = m;
  else if (m.t === 'toast') toasts.push(m);
  else if (m.t === 'claim') claims.push(m.claim);
});
const send = (m) => ws.send(JSON.stringify(m));
await new Promise((r) => ws.on('open', r));
send({ t: 'hello', name: 'Founder' });
await waitFor(() => me, 'welcome');

async function liveLand(cx, cy) {
  chunks.delete(`${cx},${cy}`);
  send({ t: 'sub', chunks: [] }); send({ t: 'sub', chunks: [[cx, cy]] });
  return chunkLandCount(await waitFor(() => chunks.get(`${cx},${cy}`), `chunk ${cx},${cy}`));
}
async function claim(cx, cy) {
  const nT = toasts.length, nC = claims.length;
  send({ t: 'claim', cx, cy });
  await waitFor(() => claims.slice(nC).some((c) => c.cx === cx && c.cy === cy && c.ownerId === me.id) || toasts.slice(nT).some((t) => t.kind === 'error'), `claim answer for ${cx},${cy}`);
  const err = toasts.slice(nT).find((t) => t.kind === 'error');
  return err ? err.msg : null;
}

const { small, big } = pairs[0];
const smallLand = await liveLand(small.cx, small.cy);
const bigLand = await liveLand(big.cx, big.cy);
console.log(`mostly-water plot ${small.cx},${small.cy}: ${smallLand} land tiles; neighbour ${big.cx},${big.cy}: ${bigLand}`);
if (smallLand < MIN_LAND_TILES_TO_CLAIM || smallLand >= MIN_LAND_TILES_FIRST_CLAIM) fail(`live land ${smallLand} is not between the two thresholds`);

// 1. a first claim on the mostly-water plot is refused, saying how much land a first plot needs
const refused = await claim(small.cx, small.cy);
if (!refused) fail('a first claim on a mostly-water plot was accepted');
const need = MIN_LAND_TILES_FIRST_CLAIM.toLocaleString('en-US');
if (!refused.includes(need)) fail(`refusal does not say how much land is needed: "${refused}"`);
console.log('first claim refused:', refused);

// 2. findFree from there answers a plot with enough land for a first plot, and it can be claimed
spot = null; send({ t: 'findFree', cx: small.cx, cy: small.cy });
await waitFor(() => spot, 'freeSpot');
if (spot.cx === null) fail('findFree found nothing');
if (spot.cx === small.cx && spot.cy === small.cy) fail('findFree answered the mostly-water plot');
const spotLand = await liveLand(spot.cx, spot.cy);
if (spotLand < MIN_LAND_TILES_FIRST_CLAIM) fail(`findFree answered ${spot.cx},${spot.cy} with only ${spotLand} land tiles`);
console.log(`findFree -> ${spot.cx},${spot.cy} with ${spotLand} land tiles`);

// 3. found the city next to the mostly-water plot instead; then that plot can be bought as an extra one
const founded = await claim(big.cx, big.cy);
if (founded) fail(`founding on ${big.cx},${big.cy} (${bigLand} land) was refused: ${founded}`);
send({ t: 'devFunds', amount: 100_000 });
await sleep(300);
const extra = await claim(small.cx, small.cy);
if (extra) fail(`the mostly-water plot was refused as an extra, adjacent plot: ${extra}`);
console.log('founded on the neighbour, then bought the mostly-water plot as plot #2');
console.log('PASS'); process.exit(0);
