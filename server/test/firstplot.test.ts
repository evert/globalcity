// A founding (first) plot needs MIN_LAND_TILES_FIRST_CLAIM land tiles; an extra, adjacent plot only
// MIN_LAND_TILES_TO_CLAIM, so a coastal strip next to your city can still be bought.
//  - a new mayor's claim on a mostly-water plot is refused, and the message says how much land is needed
//  - findFree from there answers a plot that meets the founding rule, and claiming it works
//  - once they own a plot, the same mostly-water plot (adjacent) can be bought
// The plots are the fixture's island (support/fixture.ts) and the coast east of it; the land counts are re-checked on
// the live tiles the server sends.
import { describe, it, expect, beforeAll } from 'vitest';
import { chunkKey, chunkLandCount, CHUNKS_X, MIN_LAND_TILES_FIRST_CLAIM, MIN_LAND_TILES_TO_CLAIM } from '@globalcity/shared';
import { TestClient, resetServer, sleep } from './support/client.ts';
import { buildFixture, landPerChunk, site } from './support/fixture.ts';

type Chunk = { cx: number; cy: number };

/** A mostly-water plot (enough land for an extra plot, not for a first) next to a plot with plenty: the island. */
function candidates(): { small: Chunk; big: Chunk }[] {
  const small = site('island'),
    big = { cx: small.cx + 1, cy: small.cy };
  const land = landPerChunk(buildFixture()),
    at = (c: Chunk): number => land[c.cy * CHUNKS_X + c.cx];
  // as the old search on the generated world picked them: clearly in between, next to one with twice a first plot
  const n = at(small);
  return n >= MIN_LAND_TILES_TO_CLAIM * 4 && n < MIN_LAND_TILES_FIRST_CLAIM / 2 && at(big) >= MIN_LAND_TILES_FIRST_CLAIM * 2 ? [{ small, big }] : [];
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
    expect(pairs.length, 'a mostly-water plot next to a plot with plenty of land in the fixture').toBeGreaterThan(0);
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
