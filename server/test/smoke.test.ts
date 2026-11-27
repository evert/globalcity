// Smoke test: connect, found a city near London, build a small powered neighbourhood, verify stats flow.
import { describe, it, expect, beforeAll } from 'vitest';
import { CHUNK, STARTING_FUNDS, COAL_POWER, lonLatToTile, chunkOf, isWater, isTree } from '@globalcity/shared';
import { TestClient, resetServer, sleep, waitFor } from './support/client.ts';

const WAIT_MS = 15_000;
// a 15x5 rectangle of land for: coal plant (4x4) | 2 wires | 3 res zones; road along row 4 below them
const RW = 15,
  RH = 5;

describe('smoke', () => {
  let c: TestClient;
  let site: { cx: number; cy: number; x: number; y: number };
  beforeAll(async () => {
    await resetServer();
    c = await TestClient.connect('SmokeTester');
  });

  it('welcomes a new mayor', () => {
    const w = c.welcome!;
    expect(w.player.name).toBe('SmokeTester');
    expect(w.stats.funds).toBe(STARTING_FUNDS);
    expect(w.world.chunk).toBe(CHUNK);
  });

  it('founds a city on the nearest free chunk to London', async () => {
    const london = lonLatToTile(-0.1, 51.5);
    const lc = chunkOf(london.x, london.y);
    const spot = await c.findFree(lc.cx, lc.cy);
    expect(spot, 'a free chunk near London').not.toBeNull();
    const { cx, cy } = spot!;
    c.send({ t: 'claim', cx, cy });
    await waitFor(() => c.myClaims().length > 0, 'claim broadcast');
    await c.subscribe([[cx, cy]]);
    const tiles = c.chunk(cx, cy);
    let origin: { x: number; y: number } | null = null;
    outer: for (let oy = 1; oy + RH < CHUNK - 1; oy++)
      for (let ox = 1; ox + RW < CHUNK - 1; ox++) {
        let ok = true;
        for (let dy = 0; dy < RH && ok; dy++)
          for (let dx = 0; dx < RW; dx++)
            if (isWater(tiles[(oy + dy) * CHUNK + ox + dx])) {
              ok = false;
              break;
            }
        if (ok) {
          origin = { x: cx * CHUNK + ox, y: cy * CHUNK + oy };
          break outer;
        }
      }
    expect(origin, 'a 15x5 land rectangle in the chunk').not.toBeNull();
    site = { cx, cy, ...origin! };
  });

  it('builds a powered neighbourhood and the stats follow', { timeout: WAIT_MS + 30_000 }, async () => {
    const { x: X, y: Y, cx, cy } = site;
    const tiles = c.chunk(cx, cy);
    // bulldoze trees in the rectangle first (exercises the bulldozer; zones would auto-bulldoze anyway)
    for (let dy = 0; dy < RH; dy++)
      for (let dx = 0; dx < RW; dx++)
        if (isTree(tiles[(Y - cy * CHUNK + dy) * CHUNK + (X - cx * CHUNK + dx)])) c.send({ t: 'build', tool: 'bulldozer', x: X + dx, y: Y + dy });
    await sleep(300);
    c.send({ t: 'build', tool: 'coal', x: X + 1, y: Y + 1 }); // footprint X..X+3, Y..Y+3
    c.send({ t: 'build', tool: 'wire', x: X + 4, y: Y + 1 });
    c.send({ t: 'build', tool: 'wire', x: X + 5, y: Y + 1 });
    c.send({ t: 'build', tool: 'residential', x: X + 7, y: Y + 1 }); // X+6..X+8
    c.send({ t: 'build', tool: 'residential', x: X + 10, y: Y + 1 }); // X+9..X+11
    c.send({ t: 'build', tool: 'residential', x: X + 13, y: Y + 1 }); // X+12..X+14
    for (let dx = 0; dx < RW; dx++) c.send({ t: 'build', tool: 'road', x: X + dx, y: Y + 4 });
    c.send({ t: 'query', x: X + 1, y: Y + 1 });
    c.send({ t: 'ping' });
    await sleep(WAIT_MS); // the simulation: power flows, zones grow, the budget runs

    const s = c.stats!;
    expect(c.statsCount, 'stats messages').toBeGreaterThanOrEqual(1);
    const expected = STARTING_FUNDS - 3000 - 2 * 5 - 3 * 100 - RW * 10; // minus auto-bulldozing, plus taxes
    expect(s.funds).toBeLessThan(STARTING_FUNDS);
    expect(s.funds, `funds higher than expected <= ${expected}`).toBeLessThanOrEqual(expected + 200);
    expect(c.tileUpdates, 'tile updates').toBeGreaterThanOrEqual(16 + 2 + 27 + RW);
    expect(s.powerSupply).toBe(COAL_POWER);
    expect(s.powerDemand, 'power demand (zones connected to the grid)').toBe(3);
    expect(c.toasts.filter((t) => t.kind === 'error')).toEqual([]);
  });

  it('counts the city in the world stats', async () => {
    c.send({ t: 'worldStats' });
    const wst = await waitFor(() => c.worldStats, 'worldStats');
    expect(wst.cities).toBeGreaterThanOrEqual(1);
    expect(wst.plots).toBeGreaterThanOrEqual(1);
    expect(wst.landPlots).toBeGreaterThanOrEqual(1000);
    expect(wst.plants).toBeGreaterThanOrEqual(1);
    expect(wst.roads).toBeGreaterThanOrEqual(1);
  });
});
