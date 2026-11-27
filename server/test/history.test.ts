// World population history: one point per game month in the world stats, oldest first, kept across a save.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetServer, closeAll, TestClient, waitFor, sleep, ticks } from './support/client.ts';

describe('world population history', () => {
  let c: TestClient;
  beforeAll(async () => {
    await resetServer();
    c = await TestClient.connect('Historian');
  });
  afterAll(closeAll);

  it('records a point every game month, in order', async () => {
    await sleep(ticks(5)); // tests run one step to the month
    c.send({ t: 'worldStats' });
    const s = await waitFor(() => c.worldStats, 'worldStats');
    const h = s.history ?? [];
    expect(h.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < h.length; i++) expect(h[i][0]).toBeCloseTo(h[i - 1][0] + 1 / 12, 6);
    for (const [, pop] of h) expect(pop).toBeGreaterThanOrEqual(0);
    expect(h[h.length - 1][0]).toBeLessThanOrEqual(s.year + 1);
  });
});
