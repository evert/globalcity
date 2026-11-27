// Monuments: a city above MONUMENT_MIN_POP can be retired as a monument. The plots pass to a frozen monument
// record (same names, flagged in claims, off the leaderboard, never claimable), the mayor gets a fresh start
// (starting funds, no plots) and can found a new city.
import { describe, it, expect, beforeAll } from 'vitest';
import { STARTING_FUNDS, type ClaimInfo } from '@globalcity/shared';
import { TestClient, resetServer, settle, sleep, waitFor, TICK } from './support/client.ts';

describe('monument', () => {
  let A: TestClient, B: TestClient;
  let s: { cx: number; cy: number; x: number; y: number };
  let key: string;
  let cityName: string | undefined;
  let mc: ClaimInfo;
  beforeAll(async () => {
    await resetServer({ monumentMinPop: 1 });
    A = await TestClient.connect('Builder', { v: 'test' });
    B = await TestClient.connect('Onlooker', { v: 'test' });
  });

  it('founds a small working town and people move in', { timeout: 60 * TICK + 30_000 }, async () => {
    s = await settle(A, [[150, 30]], 22, 12, { x0: 3, x1: 39, y0: 3, y1: 47 });
    key = `${s.cx},${s.cy}`;
    const { x: X, y: Y } = s;
    // (fixed 40 ms sleeps between builds before; the build acks now)
    await A.build('coal', X + 1, Y + 1);
    for (let x = X + 4; x < X + 20; x++) await A.build('wire', x, Y + 1);
    for (let i = 0; i < 5; i++) await A.build('residential', X + 5 + i * 3, Y + 3);
    for (let x = X; x < X + 21; x++) await A.build('road', x, Y + 5);
    const t0 = Date.now();
    while (!((A.stats?.population ?? 0) > 0) && Date.now() - t0 < 60 * TICK) await sleep(TICK);
    expect(A.stats!.population, 'the town grew').toBeGreaterThan(0);
    cityName = A.claims.get(key)?.cityName;
  });

  it('retires it as a monument and the mayor starts over', async () => {
    const welcomesBefore = A.welcomes;
    A.send({ t: 'monument' });
    await sleep(600);
    expect(A.hasToast(/is now a monument/), 'monument confirmation').toBe(true);
    expect(A.welcomes, 'a fresh welcome after the monument').toBe(welcomesBefore + 1);
    expect({ pop: A.stats!.population, chunks: A.stats!.chunks, funds: A.stats!.funds }).toEqual({ pop: 0, chunks: 0, funds: STARTING_FUNDS });
    mc = A.claims.get(key)!;
    expect(mc, 'the claim passed to the monument').toBeDefined();
    expect(mc.monument).toBe(true);
    expect(mc.ownerId).not.toBe(A.id);
    expect(mc.cityName).toBe(cityName);
    expect(mc.ownerName).toBe('Builder');
    expect(B.claims.get(key)?.monument, 'other players are told about the monument').toBe(true);
    expect(B.hasToast(/retired .* as a monument/), 'announcement for other players').toBe(true);
  });

  it('stays frozen, unclaimable and off the leaderboard', async () => {
    await sleep(TICK * 6);
    const after = B.claims.get(key);
    expect(after?.monument).toBe(true);
    expect(after?.pop, 'the monument did not change').toBe(mc.pop);
    B.send({ t: 'claim', cx: s.cx, cy: s.cy });
    await sleep(300);
    expect(B.claims.get(key)?.ownerId, 'the monument plot was not claimed').toBe(mc.ownerId);
    A.send({ t: 'leaderboard' });
    await sleep(300);
    expect(
      (A.leaderboard?.entries ?? []).some((e) => e.id === mc.ownerId),
      'monument on the leaderboard',
    ).toBe(false);
  });

  it('lets the mayor found a new city', async () => {
    const s2 = await A.findFree(s.cx + 3, s.cy);
    expect(s2).not.toBeNull();
    A.send({ t: 'claim', cx: s2!.cx, cy: s2!.cy });
    // up to 5 s: a busy machine is slow
    await waitFor(() => A.claims.get(`${s2!.cx},${s2!.cy}`)?.ownerId === A.id, `a new city at ${s2!.cx},${s2!.cy}`).catch(() => undefined);
    expect(A.claims.get(`${s2!.cx},${s2!.cy}`)?.ownerId, `new city (${A.toastText()})`).toBe(A.id);
  });
});
