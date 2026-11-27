// Abandoning a city (any city: here a broke one that owes a lifeline): the plots are released (unclaim broadcast)
// and the mayor starts over ($20,000, debt written off), but can't claim the plots they left for a week. Nothing
// crumbles: the town stays as it was, and a new mayor who claims the plot gets it, buildings and all, for the normal
// plot price (the first plot is free), with its power and zones working.
import { describe, it, expect, beforeAll } from 'vitest';
import { LOMASK, ZONEBIT, ROADBASE, chunkKey, isRubble } from '@globalcity/shared';
import { TestClient, resetServer, settle, sleep, TICK } from './support/client.ts';
import { at } from './support/fixture.ts';

/** The latest toast as "kind: msg". */
const last = (c: TestClient): string => {
  const t = c.toasts[c.toasts.length - 1];
  return t ? `${t.kind}: ${t.msg}` : '';
};

describe('abandoning a city', () => {
  let A: TestClient, B: TestClient;
  let spot: { cx: number; cy: number };
  let key: string;
  let X: number, Y: number;
  const tiles = (): Uint32Array => B.chunk(spot.cx, spot.cy);
  beforeAll(async () => {
    await resetServer();
    A = await TestClient.connect('Unlucky Mayor', { v: 'test' });
    B = await TestClient.connect('Newcomer', { v: 'test' });
  });

  it('builds a small working town', { timeout: 60 * TICK + 30_000 }, async () => {
    const site = await settle(A, [at('inland')], 22, 12, { x0: 3, x1: 39, y0: 3, y1: 47 });
    spot = { cx: site.cx, cy: site.cy };
    key = chunkKey(spot.cx, spot.cy);
    X = site.x;
    Y = site.y;
    await B.subscribe([[spot.cx, spot.cy]]);
    // a coal plant, a power line, homes and a road
    await A.build('coal', X + 1, Y + 1);
    for (let x = X + 4; x < X + 20; x++) await A.build('wire', x, Y + 1);
    for (let i = 0; i < 5; i++) await A.build('residential', X + 5 + i * 3, Y + 3);
    for (let x = X; x < X + 21; x++) await A.build('road', x, Y + 5);
    const t0 = Date.now();
    while (!((A.stats?.population ?? 0) > 0) && Date.now() - t0 < 60 * TICK) await sleep(TICK);
    expect(A.stats!.population, 'the town grew').toBeGreaterThan(0);
  });

  it('lets the broke mayor take a lifeline, then abandon the city', async () => {
    A.sendRaw({ t: 'devSetFunds', amount: 50 });
    await sleep(300);
    A.send({ t: 'lifeline' });
    await sleep(300);
    expect(A.stats!.debt, 'lifeline taken').toBeGreaterThan(0);
    A.sendRaw({ t: 'devSetFunds', amount: 50 });
    await sleep(300);
    const before = A.welcomes;
    A.send({ t: 'abandon' });
    await sleep(600);
    expect(last(A), 'the toast says the plots can be claimed with their buildings').toMatch(/Anyone can claim its plots and everything built on them/);
    expect(A.welcomes, 'a fresh welcome').toBe(before + 1);
    expect({ funds: A.stats!.funds, debt: A.stats!.debt, chunks: A.stats!.chunks }, 'the mayor starts over').toEqual({ funds: 20000, debt: 0, chunks: 0 });
    expect(B.unclaims, 'the plot is released').toContain(key);
  });

  it('refuses abandoning again, and reclaiming the plot just left', async () => {
    A.send({ t: 'abandon' });
    await sleep(300);
    expect(last(A)).toMatch(/You have no city to abandon/);
    // no free restart with the old town: the mayor can't claim the plot they just left
    A.send({ t: 'claim', cx: spot.cx, cy: spot.cy });
    await sleep(300);
    expect(last(A)).toMatch(/You left this plot when you abandoned your city: you can claim it again in 7 days/);
    expect(A.stats!.chunks, 'the mayor did not get their old plot back').toBe(0);
  });

  it('leaves the released town standing', { timeout: 30 * TICK + 10_000 }, async () => {
    const census = (): { rubble: number; zones: number } => {
      let rubble = 0,
        zones = 0;
      for (const v of tiles()) {
        if (isRubble(v)) rubble++;
        if (v & ZONEBIT) zones++;
      }
      return { rubble, zones };
    };
    const s0 = Array.from(tiles(), (v) => v & LOMASK),
      c0 = census();
    await sleep(30 * TICK);
    const c1 = census();
    expect(c1.rubble, 'the released town did not crumble').toBeLessThanOrEqual(c0.rubble);
    expect(c1.zones, 'zones/buildings on the released plot').toBe(c0.zones);
    expect(c1.zones).toBeGreaterThanOrEqual(6);
    let lost = 0;
    tiles().forEach((v, i) => {
      if (s0[i] >= ROADBASE && (v & LOMASK) < ROADBASE) lost++;
    });
    expect(lost, 'built tiles turned into rubble or land').toBe(0);
  });

  it('hands the town to a new mayor, free, with power and people', { timeout: 20 * TICK + 10_000 }, async () => {
    const nB = B.toasts.length;
    B.send({ t: 'claim', cx: spot.cx, cy: spot.cy });
    await sleep(600);
    const claimToast = B.toastText(nB);
    expect(claimToast, 'the claim toast mentions the buildings taken over').toMatch(/^success: Welcome, Mayor!.*zones and buildings already standing there/);
    expect(B.stats!.chunks, 'the newcomer owns the plot').toBe(1);
    // power and zones keep working for the new owner: the homes are powered and people live there
    const t0 = Date.now();
    while (!((B.stats?.population ?? 0) > 0 && (B.stats?.powerSupply ?? 0) > 0) && Date.now() - t0 < 20 * TICK) await sleep(TICK);
    const home = await B.query(X + 5, Y + 3);
    expect(B.stats!.population, 'the taken-over town has people').toBeGreaterThan(0);
    const book = B.stats!.budget?.current;
    expect(book, 'the books').toBeTruthy();
    expect(book!.plots, 'charged for the plot').toBe(0);
    expect(book!.construction, 'charged for its buildings').toBe(0);
    expect(B.stats!.powerSupply, 'the taken-over coal plant supplies power').toBeGreaterThan(0);
    expect(home.powered, 'the taken-over homes are powered').toBe(true);
    expect(home.owner?.name, "the homes are the newcomer's").toBe('Newcomer');
  });

  it('lets a city with money be abandoned too, and its mayor found a new one elsewhere', async () => {
    const R = await TestClient.connect('Restless Mayor', { v: 'test' });
    const first = await R.findFree(...at('inland'));
    expect(first).not.toBeNull();
    R.send({ t: 'claim', cx: first!.cx, cy: first!.cy });
    await sleep(400);
    expect(R.stats!.chunks, `restless mayor has a plot (${last(R)})`).toBe(1);
    R.send({ t: 'abandon' });
    await sleep(400);
    expect(last(R)).toMatch(/Anyone can claim its plots/);
    expect(R.stats!.chunks).toBe(0);
    const next = await R.findFree(...at('east'));
    expect(next).not.toBeNull();
    expect(chunkKey(next!.cx, next!.cy), 'findFree does not offer the plot just left').not.toBe(chunkKey(first!.cx, first!.cy));
    R.send({ t: 'claim', cx: next!.cx, cy: next!.cy });
    await sleep(400);
    expect(R.stats!.chunks, `founded a new city elsewhere (${last(R)})`).toBe(1);
  });
});
