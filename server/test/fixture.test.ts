// The fixture world (support/fixture.ts) as the server plays it: its size reaches the client, and the named sites the
// other tests rely on are what they say they are.
import { describe, it, expect, beforeAll } from 'vitest';
import { CHUNK, MIN_LAND_TILES_FIRST_CLAIM, MIN_LAND_TILES_TO_CLAIM, chunkKey, chunkLandCount, isWater } from '@globalcity/shared';
import { TestClient, resetServer } from './support/client.ts';
import { FIXTURE_H, FIXTURE_W, at, site, type SiteName } from './support/fixture.ts';

describe('the fixture world', () => {
  let c: TestClient;
  /** What the server says is at local (x, y) of a site's plot. */
  const ask = async (name: SiteName, x: number, y: number): Promise<{ name: string; elev?: number }> => {
    const s = site(name);
    return c.query(s.cx * CHUNK + x, s.cy * CHUNK + y);
  };
  const land = async (name: SiteName): Promise<number> => {
    const s = site(name);
    await c.subscribe([[s.cx, s.cy]]);
    return chunkLandCount(c.chunk(s.cx, s.cy));
  };

  beforeAll(async () => {
    await resetServer();
    c = await TestClient.connect('Surveyor');
  });

  it('is the size its base.json says, in the welcome', () => {
    expect(c.welcome!.world).toEqual({ w: FIXTURE_W, h: FIXTURE_H, chunk: CHUNK });
  });

  it('has the land and water the sites promise', async () => {
    expect(await land('inland'), 'inland is all land').toBe(CHUNK * CHUNK);
    expect(await land('east')).toBe(CHUNK * CHUNK);
    expect(await land('sea'), 'open sea').toBe(0);
    const coast = await land('coast');
    expect(coast, 'the coast has room for a first city').toBeGreaterThanOrEqual(MIN_LAND_TILES_FIRST_CLAIM);
    expect(coast, '... and sea').toBeLessThan(CHUNK * CHUNK);
    const island = await land('island');
    expect(island, 'the island is an extra plot').toBeGreaterThanOrEqual(MIN_LAND_TILES_TO_CLAIM);
    expect(island, '... but too small for a first one').toBeLessThan(MIN_LAND_TILES_FIRST_CLAIM);
    for (const name of ['lake', 'river'] as const) {
      const n = await land(name);
      expect(n > 0 && n < CHUNK * CHUNK, `${name}: land and water`).toBe(true);
    }
    const s = site('coast');
    await c.subscribe([[s.cx, s.cy]]);
    expect(isWater(c.chunk(s.cx, s.cy)[32 * CHUNK + 4]), 'the coast plot starts with sea').toBe(true);
  });

  it('has its biomes, ice and elevation', async () => {
    expect((await ask('inland', 40, 40)).name).toBe('Dirt');
    expect((await ask('desert', 32, 32)).name).toBe('Sand');
    expect((await ask('snow', 32, 32)).name).toBe('Ice sheet');
    expect((await ask('frozen', 32, 32)).name).toBe('Ice');
    expect((await ask('sea', 32, 32)).name).toBe('Water');
    expect((await ask('lake', 32, 28)).name).toBe('Water');
    expect((await ask('forest', 32, 32)).name).toBe('Woods');
    const shore = await ask('coast', 26, 32),
      inland = await ask('coast', 50, 32);
    expect(shore.elev, 'low land by the sea on the coast (floods)').toBeLessThanOrEqual(10);
    expect(inland.elev, 'higher ground further in').toBeGreaterThan(10);
  });

  it('names cities after its places', async () => {
    const s = await c.findFree(...at('inland'));
    expect(await c.tryClaim(s!.cx, s!.cy)).toBe(true);
    expect(c.claims.get(chunkKey(s!.cx, s!.cy))?.cityName, 'the biggest place nearby').toBe('Middleton');
  });
});
