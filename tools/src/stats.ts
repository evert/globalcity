import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORLD_W as W, WORLD_H as H, CHUNK, MIN_LAND_TILES_TO_CLAIM } from '@globalcity/shared';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const g = readFileSync(resolve(ROOT, 'data/world/base.bin'));
if (g.length !== W * H) throw new Error(`base.bin size ${g.length} != ${W * H}`);
let land = 0, forest = 0;
for (let i = 0; i < g.length; i++) { if (g[i] >= 1) land++; if (g[i] === 2) forest++; }
let claimable = 0, partial = 0;
const cx = W / CHUNK, cy = H / CHUNK;
for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
  let n = 0;
  for (let y = 0; y < CHUNK; y++) { const o = (j * CHUNK + y) * W + i * CHUNK; for (let x = 0; x < CHUNK; x++) if (g[o + x] >= 1) n++; }
  if (n >= MIN_LAND_TILES_TO_CLAIM) claimable++;
  if (n > 0) partial++;
}
console.log(`world ${W}x${H}, chunks ${cx}x${cy} = ${cx * cy}`);
console.log(`land fraction: ${(land / g.length * 100).toFixed(2)}%  forest of land: ${(forest / land * 100).toFixed(2)}%`);
console.log(`chunks with any land: ${partial}`);
console.log(`claimable chunks (>= ${MIN_LAND_TILES_TO_CLAIM} land tiles): ${claimable}`);
