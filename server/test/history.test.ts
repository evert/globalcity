// World population history: one point per game year in the world stats, oldest first; long histories are sent
// as at most HISTORY_POINTS averaged points.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetServer, closeAll, TestClient, waitFor, sleep, ticks } from './support/client.ts';
import { bucketed } from '../src/worldstats.ts';

describe('world population history', () => {
  let c: TestClient;
  beforeAll(async () => {
    await resetServer();
    c = await TestClient.connect('Historian');
  });
  afterAll(closeAll);

  it('records a point every game year, in order', async () => {
    await sleep(ticks(30)); // tests run one step to the month: two and a half years
    c.send({ t: 'worldStats' });
    const s = await waitFor(() => c.worldStats, 'worldStats');
    const h = s.history ?? [];
    expect(h.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < h.length; i++) expect(h[i][0]).toBe(h[i - 1][0] + 1);
    for (const [, pop] of h) expect(pop).toBeGreaterThanOrEqual(0);
    expect(h[h.length - 1][0]).toBeLessThanOrEqual(s.year);
  });

  it('sends a long history as averaged buckets, the last point exact', () => {
    const years = Array.from({ length: 8640 }, (_, i): [number, number] => [1900 + i, i * 1000]); // ~6 months of server time
    const b = bucketed(years, 500);
    expect(b.length).toBe(500);
    expect(b[0][0]).toBeGreaterThanOrEqual(1900);
    expect(b[b.length - 1]).toEqual(years[years.length - 1]);
    for (let i = 1; i < b.length; i++) expect(b[i][0]).toBeGreaterThan(b[i - 1][0]);
    expect(bucketed(years.slice(0, 300), 500)).toEqual(years.slice(0, 300)); // short histories go as they are
  });
});
