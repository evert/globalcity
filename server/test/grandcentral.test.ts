// Grand Central: locked until the city's rail reaches another mayor's city; placed over an east-west line (clicking
// the rail tile), its bottom row is real rail joined to the line on both sides; one per city; the track can't be
// bulldozed or built over on its own; bulldozing the station leaves the track.
import { describe, it, expect, beforeAll } from 'vitest';
import { LOMASK, type ToolId } from '@globalcity/shared';
import { TestClient, resetServer, settle, sleep, TICK } from './support/client.ts';
import { at } from './support/fixture.ts';

const CUSTOMFILL = 1017,
  CUSTOMCENTRE = 1018,
  LHRAIL = 226;
const isRail = (v: number | undefined): boolean => {
  const t = (v ?? 0) & LOMASK;
  return t >= 224 && t <= 238;
};

describe('grandcentral', () => {
  let A: TestClient;
  let X = 0,
    R = 0;
  /** Build; the toasts it brought as "kind: msg". */
  const build = async (tool: ToolId, x: number, y: number): Promise<string[]> => (await A.build(tool, x, y)).toasts.map((t) => `${t.kind}: ${t.msg}`);

  beforeAll(async () => {
    await resetServer();
    A = await TestClient.connect('Stationmaster', { v: 'test' });
  });

  it('is locked until the rail reaches another city', async () => {
    const site = await settle(A, [at('inland'), at('east')], 18, 12, { x0: 2, x1: 43, y0: 2, y1: 49 });
    X = site.x;
    R = site.y + 2; // the line
    await sleep(300);
    A.sendRaw({ t: 'devFunds', amount: 100000 });
    await sleep(200);
    for (let x = X; x < X + 12; x++) await build('rail', x, R);
    const t = await build('grandcentral', X + 3, R);
    expect(
      t.some((x) => /unlocks when you connect your rail network/.test(x)),
      t.join(' | '),
    ).toBe(true);
    A.sendRaw({ t: 'devRailLink' });
    await sleep(300);
    expect(A.stats!.unlocked).toContain('grandcentral');
  });

  it('is placed over the line, its bottom row real rail joined on both sides', async () => {
    // clicking the rail tile at (X+3, R): footprint x X+1..X+6, rows R-2..R
    await build('grandcentral', X + 3, R);
    expect(A.buildingEvents).toContain(`add grandcentral ${X + 1},${R - 2}`);
    for (let dx = 0; dx < 6; dx++) {
      expect(isRail(A.tile(X + 1 + dx, R)), `station row tile ${dx} is rail (${(A.tile(X + 1 + dx, R) ?? 0) & LOMASK})`).toBe(true);
      for (const dy of [1, 2]) expect([CUSTOMFILL, CUSTOMCENTRE], `hall tile ${dx},${dy}`).toContain(A.kind(X + 1 + dx, R - dy));
    }
    expect(isRail(A.tile(X, R)) && isRail(A.tile(X + 7, R)), 'the line outside the station is still rail').toBe(true);
  });

  it('is one per city, and its track resists the bulldozer and roads', async () => {
    let t = await build('grandcentral', X + 3, R + 8);
    expect(
      t.some((x) => /already has a Grand Central/.test(x)),
      t.join(' | '),
    ).toBe(true);
    t = await build('bulldozer', X + 3, R);
    expect(
      t.some((x) => /track runs through Grand Central/.test(x)),
      t.join(' | '),
    ).toBe(true);
    expect(isRail(A.tile(X + 3, R))).toBe(true);
    t = await build('road', X + 3, R);
    expect(
      t.some((x) => /part of the grand central/.test(x)),
      t.join(' | '),
    ).toBe(true);
  });

  it('is counted, and bulldozing it leaves the track', async () => {
    // tick a little: upkeep and stats run with the station
    await sleep(TICK * 3);
    expect(A.stats!.built?.grandcentral ?? 0).toBe(1);
    await build('bulldozer', X + 2, R - 2);
    expect(A.buildingEvents).toContain(`remove grandcentral ${X + 1},${R - 2}`);
    for (let dx = 0; dx < 6; dx++) expect(isRail(A.tile(X + 1 + dx, R)), 'track stays after bulldozing the station').toBe(true);
  });

  it('lays its own track on bare land', async () => {
    const t = await build('grandcentral', X + 3, R + 6);
    expect(A.buildingEvents, t.join(' | ')).toContain(`add grandcentral ${X + 1},${R + 4}`);
    for (let dx = 0; dx < 6; dx++) expect(A.kind(X + 1 + dx, R + 6)).toBe(LHRAIL);
  });
});
