// Milestones: locked until the population threshold, one per city, rebuildable, grandfathered extras; plus rail
// counting as transport access for zone growth, early milestones, and wind and offshore power.
import { describe, it, expect, beforeAll } from 'vitest';
import { CHUNK, LOMASK, ZONEBIT, WIND_POWER, isWater, type ToolId } from '@globalcity/shared';
import { TestClient, resetServer, settle, sleep, TICK } from './support/client.ts';

const CITYHALL = 965,
  OFFSHORE = 1006;
const ticks = (n: number): Promise<void> => sleep(n * TICK);

/** Build; the toasts it brought as "kind: msg". */
const build = async (c: TestClient, tool: ToolId, x: number, y: number): Promise<string[]> =>
  (await c.build(tool, x, y)).toasts.map((t) => `${t.kind}: ${t.msg}`);

/** The old test's site search: (cx, cy) and four spots around it, a dry w x h site at offsets 2..61-w, 2..61-h;
 *  claimed, with $200,000 granted. */
async function city(c: TestClient, cx: number, cy: number, w: number, h: number): Promise<{ X: number; Y: number }> {
  const s = await settle(
    c,
    [
      [cx, cy],
      [cx + 12, cy + 4],
      [cx - 16, cy + 8],
      [cx + 24, cy - 6],
      [cx + 2, cy + 2],
    ],
    w,
    h,
    { x0: 2, x1: 61 - w, y0: 2, y1: 61 - h },
  );
  await sleep(300);
  c.sendRaw({ t: 'devFunds', amount: 200000 });
  await sleep(200);
  return { X: s.x, Y: s.y };
}

describe('milestones', () => {
  beforeAll(() => resetServer());

  it('city hall: locked, unlocked by the milestone, one per city, rebuildable', { timeout: 60_000 }, async () => {
    const A = await TestClient.connect('Mayor-A', { v: 'test' });
    const a = await city(A, 140, 28, 20, 12);
    await build(A, 'residential', a.X + 15, a.Y + 9); // a city with a zone, so it is simulated
    let t = await build(A, 'cityhall', a.X + 1, a.Y + 1);
    expect(
      t.some((x) => /unlocks at 75,000 people/.test(x)),
      t.join(' | '),
    ).toBe(true);
    A.sendRaw({ t: 'devPeak', pop: 80000 });
    await ticks(3);
    expect(A.stats!.unlocked).toContain('cityhall');
    expect(A.stats!.unlocked).not.toContain('seaport');
    expect(A.hasToast(/Milestone: 75,000 people/), 'milestone message').toBe(true);
    t = await build(A, 'cityhall', a.X + 1, a.Y + 1);
    const v = A.tile(a.X + 1, a.Y + 1)!;
    expect((v & LOMASK) === CITYHALL && (v & ZONEBIT) !== 0, `city hall placed: ${t.join(' | ')}`).toBe(true);
    t = await build(A, 'cityhall', a.X + 7, a.Y + 1);
    expect(
      t.some((x) => /already has a city hall/.test(x)),
      t.join(' | '),
    ).toBe(true);
    await ticks(2);
    expect(A.stats!.built.cityhall).toBe(1);
    await build(A, 'bulldozer', a.X + 1, a.Y + 1);
    await ticks(2);
    expect(A.stats!.built.cityhall, 'city hall gone').toBe(0);
    t = await build(A, 'cityhall', a.X + 7, a.Y + 1);
    expect(A.kind(a.X + 7, a.Y + 1), `rebuild: ${t.join(' | ')}`).toBe(CITYHALL);
  });

  it('grandfathering: a pre-milestone city keeps its two airports, and may add a third', async () => {
    const B = await TestClient.connect('Mayor-B', { v: 'test' });
    const b = await city(B, 180, 40, 15, 15);
    B.sendRaw({ t: 'devPlace', tool: 'airport', x: b.X + 1, y: b.Y + 1 });
    await sleep(200);
    B.sendRaw({ t: 'devPlace', tool: 'airport', x: b.X + 8, y: b.Y + 1 });
    await sleep(200);
    await ticks(3);
    expect(B.stats!.built.airport).toBe(2);
    expect(B.stats!.unlocked).toContain('airport');
    B.sendRaw({ t: 'devFunds', amount: 50000 });
    await sleep(200);
    const t = await build(B, 'airport', b.X + 1, b.Y + 8);
    await ticks(2);
    // no per-city limit any more
    expect(
      t.filter((x) => x.startsWith('error')),
      'third airport allowed',
    ).toEqual([]);
  });

  it('rail counts as transport access', { timeout: 60_000 }, async () => {
    const R = await TestClient.connect('Mayor-R', { v: 'test' });
    const r = await city(R, 220, 44, 16, 8);
    await build(R, 'coal', r.X + 1, r.Y + 1);
    for (let x = r.X + 4; x < r.X + 9; x++) await build(R, 'wire', x, r.Y + 1);
    await build(R, 'residential', r.X + 10, r.Y + 1);
    for (let x = r.X; x < r.X + 14; x++) await build(R, 'rail', x, r.Y + 4); // rail along the zone, no road anywhere
    let grew = false;
    for (let k = 0; k < 40 && !grew; k++) {
      R.send({ t: 'ping' });
      await ticks(1);
      grew = (R.stats?.population ?? 0) > 0;
    }
    expect(grew, 'zone with only rail access grew').toBe(true);
  });

  it('early milestones and wind power; no fires spread before the fire milestone', { timeout: 60_000 }, async () => {
    const W = await TestClient.connect('Mayor-W', { v: 'test' });
    const w = await city(W, 132, 36, 20, 10);
    let t = await build(W, 'fire', w.X + 1, w.Y + 1);
    expect(
      t.some((x) => /unlocks at 15,000 people/.test(x)),
      t.join(' | '),
    ).toBe(true);
    // a row of road in a city below the fire milestone: an ignited tile must not spread
    for (let x = w.X; x < w.X + 12; x++) await build(W, 'road', x, w.Y + 8);
    W.sendRaw({ t: 'devIgnite', x: w.X + 6, y: w.Y + 8 });
    await ticks(14);
    let burnt = 0;
    for (let x = w.X; x < w.X + 12; x++) {
      const id = W.kind(x, w.Y + 8);
      if (!(id >= 64 && id <= 206)) burnt++;
    }
    expect(burnt, 'road tiles lost to a fire in a city below 15,000 people').toBeLessThanOrEqual(1);
    W.sendRaw({ t: 'devPeak', pop: 60000 });
    await ticks(2);
    for (const b of ['fire', 'police', 'school']) expect(W.stats!.unlocked).toContain(b);
    for (const b of ['cityhall', 'windfarm', 'airport']) expect(W.stats!.unlocked, `${b} still locked at 60,000`).not.toContain(b);
    W.sendRaw({ t: 'devPeak', pop: 160000 });
    await ticks(2); // the wind farm unlocks at 150,000
    expect(W.stats!.unlocked).toContain('windfarm');
    await build(W, 'residential', w.X + 15, w.Y + 2); // keep the city simulated
    await build(W, 'windfarm', w.X + 1, w.Y + 2);
    await ticks(3);
    expect(W.stats!.powerSupply).toBeGreaterThanOrEqual(WIND_POWER);
  });

  it('offshore wind: 300,000 people and a 4x4 of water; bulldozed, it leaves water', async () => {
    const O = await TestClient.connect('Mayor-O', { v: 'test' });
    const square = (tiles: Uint32Array, wet: boolean, cx: number, cy: number): { x: number; y: number } | null => {
      for (let y = 2; y < 58; y++)
        for (let x = 2; x < 58; x++) {
          let ok = true;
          for (let dy = 0; dy < 4 && ok; dy++)
            for (let dx = 0; dx < 4; dx++)
              if (isWater(tiles[(y + dy) * CHUNK + x + dx]) !== wet) {
                ok = false;
                break;
              }
          if (ok) return { x: cx * CHUNK + x, y: cy * CHUNK + y };
        }
      return null;
    };
    let site: { wet: { x: number; y: number }; dry: { x: number; y: number } } | null = null;
    for (const [cx, cy] of [
      [128, 26],
      [126, 24],
      [140, 24],
      [72, 34],
      [66, 32],
      [228, 50],
      [120, 28],
    ]) {
      const spot = await O.findFree(cx, cy);
      if (!spot) continue;
      await O.subscribe([[spot.cx, spot.cy]]);
      const tiles = O.chunk(spot.cx, spot.cy);
      const wet = square(tiles, true, spot.cx, spot.cy),
        dry = square(tiles, false, spot.cx, spot.cy);
      if (wet && dry) {
        site = { wet, dry };
        await O.claim(spot.cx, spot.cy);
        await sleep(300);
        break;
      }
    }
    expect(site, 'a coastal plot with a 4x4 of open water').not.toBeNull();
    const { wet, dry } = site!;
    O.sendRaw({ t: 'devFunds', amount: 100000 });
    O.sendRaw({ t: 'devPeak', pop: 1500000 });
    await sleep(300);
    let t = await build(O, 'offshore', dry.x + 1, dry.y + 1);
    expect(
      t.some((x) => /entirely on water/.test(x)),
      `offshore refused on land: ${t.join(' | ')}`,
    ).toBe(true);
    t = await build(O, 'offshore', wet.x + 1, wet.y + 1);
    expect(O.kind(wet.x + 1, wet.y + 1), `offshore placed on water: ${t.join(' | ')}`).toBe(OFFSHORE);
    await build(O, 'bulldozer', wet.x + 1, wet.y + 1);
    let water = 0;
    for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) if (isWater(O.tile(wet.x + dx, wet.y + dy)!)) water++;
    expect(water, 'water tiles left by the bulldozed offshore farm').toBe(16);
  });
});
