// Custom-building layer: a 5x4 university is locked until 200,000 people, placed as one building, reported to
// every client, one per city, removed (and reported) by the bulldozer from any of its tiles, and destroyed whole
// by fire.
import { describe, it, expect, beforeAll } from 'vitest';
import { LOMASK, ZONEBIT, CUSTOMFILL, CUSTOMCENTRE } from '@globalcity/shared';
import { TestClient, resetServer, settle, sleep, waitFor, TICK } from './support/client.ts';
import { at } from './support/fixture.ts';

const toastsText = (r: { toasts: { kind: string; msg: string }[] }): string => r.toasts.map((t) => `${t.kind}: ${t.msg}`).join(' | ');

describe('custom buildings (the university)', () => {
  let A: TestClient, V: TestClient;
  let X: number, Y: number;
  beforeAll(async () => {
    await resetServer();
    A = await TestClient.connect('Dean', { v: 'test' });
    V = await TestClient.connect('Visitor', { v: 'test' });
  });

  it('is locked until 200,000 people', async () => {
    const site = await settle(A, [at('inland'), at('east')], 18, 12, { x0: 2, x1: 43, y0: 2, y1: 49 });
    X = site.x;
    Y = site.y;
    A.sendRaw({ t: 'devFunds', amount: 100000 });
    await sleep(200);
    const r = await A.build('university', X + 1, Y + 1);
    expect(toastsText(r)).toMatch(/unlocks at 200,000 people/);
  });

  it('is placed as one 5x4 building and reported to every client', async () => {
    A.sendRaw({ t: 'devPeak', pop: 260000 });
    await sleep(300);
    await A.build('university', X + 1, Y + 1);
    let fill = 0,
      centre = 0;
    for (let dy = 0; dy < 4; dy++)
      for (let dx = 0; dx < 5; dx++) {
        const v = A.tile(X + dx, Y + dy)!,
          id = v & LOMASK;
        if (id === CUSTOMFILL) fill++;
        if (id === CUSTOMCENTRE && v & ZONEBIT) centre++;
      }
    expect({ fill, centre }, '5x4 footprint').toEqual({ fill: 19, centre: 1 });
    await waitFor(() => V.buildingEvents.includes(`add university ${X},${Y}`), 'the visitor hears of the new building');
    expect((await A.query(X + 4, Y + 3)).name, 'query on its far corner').toBe('University');
  });

  it('is one per city', async () => {
    const r = await A.build('university', X + 9, Y + 6);
    expect(toastsText(r)).toMatch(/already has a university/);
  });

  it('is in the building list a late joiner gets', async () => {
    const L = await TestClient.connect('Late', { v: 'test' });
    await waitFor(() => L.buildings?.some((b) => b.kind === 'university' && b.x === X && b.y === Y), 'the building list with the university');
  });

  it('is bulldozed whole from any of its tiles', async () => {
    await A.build('bulldozer', X + 4, Y + 3);
    let rubble = 0;
    for (let dy = 0; dy < 4; dy++)
      for (let dx = 0; dx < 5; dx++) {
        const id = A.kind(X + dx, Y + dy);
        if (id >= 44 && id <= 47) rubble++;
      }
    expect(rubble, 'rubble over the whole footprint').toBe(20);
    await waitFor(() => V.buildingEvents.includes(`remove university ${X},${Y}`), 'the visitor hears it is gone');
  });

  it('burns down whole and leaves the layer', async () => {
    const r = await A.build('university', X + 1, Y + 7);
    expect(A.kind(X + 1, Y + 7), `rebuilt after bulldozing (${toastsText(r)})`).toBe(CUSTOMCENTRE);
    A.sendRaw({ t: 'devIgnite', x: X + 3, y: Y + 8 });
    await sleep(TICK * 2);
    expect(V.buildingEvents, 'the fire removes the building from the layer').toContain(`remove university ${X},${Y + 6}`);
  });
});
