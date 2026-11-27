// World population and climate history: one point per game year in the world stats, oldest first; long histories
// are sent as at most HISTORY_POINTS averaged points. A coal plant makes the world emit CO2 and all its power dirty.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { START_PPM } from '@globalcity/shared';
import { resetServer, closeAll, TestClient, waitFor, sleep, ticks, settle } from './support/client.ts';
import { at } from './support/fixture.ts';
import { bucketed } from '../src/worldstats.ts';

describe('world population and climate history', () => {
  let c: TestClient;
  beforeAll(async () => {
    await resetServer();
    c = await TestClient.connect('Historian');
  });
  afterAll(closeAll);

  it('records a point every game year, in order, and the climate with it', async () => {
    const s0 = await settle(c, [at('inland'), at('east')], 6, 6);
    const coal = await c.build('coal', s0.x + 1, s0.y + 1);
    expect(coal.ok, 'coal plant built').toBe(true);
    await sleep(ticks(30)); // tests run one step to the month: two and a half years
    c.send({ t: 'worldStats' });
    const s = await waitFor(() => c.worldStats, 'worldStats');
    const h = s.history ?? [];
    expect(h.length).toBeGreaterThanOrEqual(2);
    // yearly points from the start (seeded when the world began), then a live point for now
    for (let i = 1; i < h.length - 1; i++) expect(h[i][0]).toBe(h[i - 1][0] + 1);
    expect(h[h.length - 1][0]).toBeGreaterThan(h[h.length - 2][0]);
    for (const [, pop] of h) expect(pop).toBeGreaterThanOrEqual(0);
    expect(h[h.length - 1][0]).toBeLessThan(s.year + 1);
    // climate: one coal plant, no clean power; CO2 above where it started, a warming point every year
    const cl = s.climate!;
    expect(cl, 'climate in the world stats').toBeTruthy();
    expect(cl.cleanShare).toBe(0);
    expect(cl.emissions).toBe(2); // one coal plant, 2 Mt a year
    expect(cl.co2).toBeGreaterThan(START_PPM - 1);
    expect(cl.history.map((p) => p[0])).toEqual(h.map((p) => p[0]));
    expect(cl.warming).toBe(Math.round(cl.history[cl.history.length - 1][1] * 100) / 100);
  });

  it('sends a long history as averaged buckets, the last point exact', () => {
    const years = Array.from({ length: 8640 }, (_, i): [number, number] => [1900 + i, i * 1000]); // ~6 months of server time
    const b = bucketed(years, 500);
    expect(b.length).toBe(500);
    expect(b[0][0]).toBeGreaterThanOrEqual(1900);
    expect(b[b.length - 1]).toEqual(years[years.length - 1]);
    for (let i = 1; i < b.length; i++) expect(b[i][0]).toBeGreaterThan(b[i - 1][0]);
    expect(bucketed(years.slice(0, 300), 500)).toEqual(years.slice(0, 300)); // short histories go as they are
    const warm = bucketed(
      Array.from({ length: 1000 }, (_, i): [number, number] => [1900 + i, 0.4]),
      100,
      3,
    );
    expect(warm[0][1]).toBe(0.4); // decimals kept
  });
});
