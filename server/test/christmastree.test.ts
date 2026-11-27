// Christmas tree: a 2x4 custom building on the milestone ladder (20,000 people, right after the fire station) that
// can only be built in December: placed in December, refused in November though unlocked.
import { describe, it, expect, beforeAll } from 'vitest';
import { LOMASK, ZONEBIT, CUSTOMFILL, CUSTOMCENTRE } from '@globalcity/shared';
import { TestClient, resetServer, settle, sleep, TICK } from './support/client.ts';

const toastsText = (r: { toasts: { kind: string; msg: string }[] }): string => r.toasts.map((t) => `${t.kind}: ${t.msg}`).join(' | ');

/** The checks both months share: found a city, climb the milestones to the tree. Returns the site. */
function climbToTheTree(month: number): { A: () => TestClient; at: () => { X: number; Y: number } } {
  let A: TestClient;
  let X: number, Y: number;
  beforeAll(async () => {
    await resetServer({ seasonMonth: month });
    A = await TestClient.connect('Mayor-Xmas', { v: 'test' });
  });

  it(`knows whether the tree is in season (month ${month})`, async () => {
    const site = await settle(
      A,
      [
        [144, 30],
        [160, 36],
        [120, 44],
        [200, 40],
      ],
      12,
      8,
      { x0: 2, x1: 49, y0: 2, y1: 49 },
    );
    X = site.x;
    Y = site.y;
    A.sendRaw({ t: 'devFunds', amount: 100000 });
    await sleep(200);
    await A.build('residential', X + 8, Y + 2); // a zone, so the city is simulated and milestones get announced
    await sleep(TICK * 3); // inSeason comes with the stats of the next tick
    expect(A.stats!.inSeason?.includes('christmastree') ?? false).toBe(month === 12);
  });

  it('is locked below 20,000 people, the milestone after the fire station', async () => {
    const r = await A.build('christmastree', X + 1, Y + 1);
    expect(toastsText(r)).toMatch(/Christmas tree unlocks at 20,000 people/);
    A.sendRaw({ t: 'devPeak', pop: 16000 });
    await sleep(TICK * 3);
    expect(A.stats!.unlocked, '16,000 unlocks the fire station').toContain('fire');
    expect(A.stats!.unlocked, '... and not the tree').not.toContain('christmastree');
    expect(A.stats!.nextMilestone, 'the next milestone after the fire station is the tree').toBe(20000);
  });

  it('unlocks at 20,000 people, with a milestone toast', async () => {
    A.sendRaw({ t: 'devPeak', pop: 21000 });
    await sleep(TICK * 3);
    expect(A.stats!.unlocked, '21,000 unlocks the tree').toContain('christmastree');
    expect(A.stats!.unlocked, '... not police').not.toContain('police');
    const toast = A.toasts.find((t) => /Milestone: 20,000/.test(`${t.kind}: ${t.msg}`));
    expect(toast?.msg, 'milestone toast').toMatch(/a Christmas tree in December/);
  });

  return { A: () => A, at: () => ({ X, Y }) };
}

describe('the Christmas tree in December', () => {
  const s = climbToTheTree(12);

  it('is placed as a 2x4 building', async () => {
    const A = s.A(),
      { X, Y } = s.at();
    await A.build('christmastree', X + 1, Y + 1);
    let fill = 0,
      centre = 0;
    for (let dy = 0; dy < 4; dy++)
      for (let dx = 0; dx < 2; dx++) {
        const v = A.tile(X + dx, Y + dy)!,
          id = v & LOMASK;
        if (id === CUSTOMFILL) fill++;
        if (id === CUSTOMCENTRE && v & ZONEBIT) centre++;
      }
    expect({ fill, centre }, '2x4 footprint').toEqual({ fill: 7, centre: 1 });
    expect(A.buildingEvents, 'the building layer reports the tree').toContain(`add christmastree ${X},${Y}`);
  });

  it('has no per-city limit', async () => {
    const A = s.A(),
      { X, Y } = s.at();
    const r = await A.build('christmastree', X + 4, Y + 1);
    expect(A.kind(X + 4, Y + 1), `a second tree (${toastsText(r)})`).toBe(CUSTOMCENTRE);
    await sleep(TICK * 3);
    expect(A.stats!.built.christmastree, 'built count').toBe(2);
  });
});

describe('the Christmas tree in November', () => {
  const s = climbToTheTree(11);

  it('is refused out of season', async () => {
    const A = s.A(),
      { X, Y } = s.at();
    const r = await A.build('christmastree', X + 1, Y + 1);
    expect(toastsText(r)).toMatch(/can only be built in December/);
    expect(A.kind(X + 1, Y + 1), 'no tree placed out of season').not.toBe(CUSTOMCENTRE);
  });
});
