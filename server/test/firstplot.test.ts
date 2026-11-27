// A founding (first) plot needs MIN_LAND_TILES_FIRST_CLAIM land tiles; an extra, adjacent plot only
// MIN_LAND_TILES_TO_CLAIM, so a coastal strip next to your city can still be bought.
//  - a new mayor's claim on a mostly-water plot is refused, and the message says how much land is needed
//  - findFree from there answers a plot that meets the founding rule, and claiming it works
//  - once they own a plot, the same mostly-water plot (adjacent) can be bought
// Candidates come from data/world-<W>x<H>/base.bin (a terrain byte per tile; BASE_WATER marks water); the land
// counts are re-checked on the live tiles the server sends.
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import {
  chunkKey,
  chunkLandCount,
  MIN_LAND_TILES_FIRST_CLAIM,
  MIN_LAND_TILES_TO_CLAIM,
  WORLD_W,
  WORLD_H,
  CHUNK,
  CHUNKS_X,
  CHUNKS_Y,
  WORLD_TAG,
  BASE_WATER,
} from '@globalcity/shared';
import { TestClient, resetServer, sleep } from './support/client.ts';

type Chunk = { cx: number; cy: number };

/** A mostly-water plot (enough land for an extra plot, not for a first) next to a plot with plenty, from base.bin. */
function candidates(): { small: Chunk; big: Chunk }[] {
  const baseFile = path.resolve(import.meta.dirname, `../../data/world-${WORLD_TAG}/base.bin`);
  const base = fs.readFileSync(baseFile);
  if (base.length !== WORLD_W * WORLD_H) throw new Error(`needs the generated world in ${baseFile}`);
  const land = new Int32Array(CHUNKS_X * CHUNKS_Y);
  for (let cy = 0; cy < CHUNKS_Y; cy++)
    for (let cx = 0; cx < CHUNKS_X; cx++) {
      let n = 0;
      for (let y = 0; y < CHUNK; y++) {
        const o = (cy * CHUNK + y) * WORLD_W + cx * CHUNK;
        for (let x = 0; x < CHUNK; x++) if (!(base[o + x] & BASE_WATER)) n++;
      }
      land[cy * CHUNKS_X + cx] = n;
    }
  const pairs: { small: Chunk; big: Chunk }[] = [];
  for (let cy = 1; cy < CHUNKS_Y - 1 && pairs.length < 5; cy++)
    for (let cx = 1; cx < CHUNKS_X - 1 && pairs.length < 5; cx++) {
      const n = land[cy * CHUNKS_X + cx];
      if (n < MIN_LAND_TILES_TO_CLAIM * 4 || n >= MIN_LAND_TILES_FIRST_CLAIM / 2) continue; // clearly in between
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        if (land[(cy + dy) * CHUNKS_X + cx + dx] >= MIN_LAND_TILES_FIRST_CLAIM * 2) {
          pairs.push({ small: { cx, cy }, big: { cx: cx + dx, cy: cy + dy } });
          break;
        }
      }
    }
  return pairs;
}

describe('first plot', () => {
  let c: TestClient;
  let small: Chunk, big: Chunk;
  let bigLand: number;

  /** Land tiles of a chunk as the server sends it now. */
  async function liveLand(cx: number, cy: number): Promise<number> {
    c.chunks.delete(chunkKey(cx, cy));
    c.send({ t: 'sub', chunks: [] });
    await c.subscribe([[cx, cy]]);
    return chunkLandCount(c.chunk(cx, cy));
  }
  /** Claim; the error toast's message, or null when it worked. */
  async function claim(cx: number, cy: number): Promise<string | null> {
    const n = c.toasts.length;
    return (await c.tryClaim(cx, cy)) ? null : (c.toasts.slice(n).find((t) => t.kind === 'error')?.msg ?? 'refused');
  }

  beforeAll(async () => {
    await resetServer();
    c = await TestClient.connect('Founder');
  });

  it('finds a mostly-water plot next to one with plenty of land', async () => {
    const pairs = candidates();
    expect(pairs.length, 'a mostly-water plot next to a plot with plenty of land in base.bin').toBeGreaterThan(0);
    ({ small, big } = pairs[0]);
    const smallLand = await liveLand(small.cx, small.cy);
    bigLand = await liveLand(big.cx, big.cy);
    expect(smallLand).toBeGreaterThanOrEqual(MIN_LAND_TILES_TO_CLAIM);
    expect(smallLand).toBeLessThan(MIN_LAND_TILES_FIRST_CLAIM);
  });

  it('refuses it as a first plot, saying how much land one needs', async () => {
    const refused = await claim(small.cx, small.cy);
    expect(refused, 'a first claim on a mostly-water plot is refused').not.toBeNull();
    expect(refused).toContain(MIN_LAND_TILES_FIRST_CLAIM.toLocaleString('en-US'));
  });

  it('findFree from there answers a plot with enough land', async () => {
    const spot = await c.findFree(small.cx, small.cy);
    expect(spot, 'findFree found something').not.toBeNull();
    expect(spot, 'findFree did not answer the mostly-water plot').not.toEqual(small);
    expect(await liveLand(spot!.cx, spot!.cy)).toBeGreaterThanOrEqual(MIN_LAND_TILES_FIRST_CLAIM);
  });

  it('sells it as an extra plot next to the city', async () => {
    expect(await claim(big.cx, big.cy), `founding on ${big.cx},${big.cy} (${bigLand} land)`).toBeNull();
    c.sendRaw({ t: 'devFunds', amount: 100_000 });
    await sleep(300);
    expect(await claim(small.cx, small.cy), 'the mostly-water plot as an extra, adjacent plot').toBeNull();
  });
});
