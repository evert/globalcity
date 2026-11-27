// Natural disasters (shared/src/disasters.ts), started with the devDisaster hook: every kind starts, announces itself
// to the mayor and shows in the 'disasters' list; earthquakes and tornadoes leave rubble; blizzards bring power lines
// down; wildfires burn; floods cover low land by the water and then recede; the neighbouring city is never touched,
// but its mayor hears the news.
import { describe, it, expect, beforeAll } from 'vitest';
import { CHUNK, LOMASK, Disaster, isWater, type ActiveDisaster } from '@globalcity/shared';
import { TestClient, resetServer, sleep, TICK } from './support/client.ts';
import { at } from './support/fixture.ts';

const isRubble = (t: number): boolean => t >= 44 && t <= 47,
  isFlood = (t: number): boolean => t >= 48 && t <= 51,
  isWire = (t: number): boolean => t >= 210 && t <= 220;

/** Every disaster in every 'disasters' list the client got, in order. */
const seen = (c: TestClient): ActiveDisaster[] => c.log.flatMap((m) => (m.t === 'disasters' ? m.list : []));

describe('disasters', () => {
  let A: TestClient, B: TestClient;
  let s: { cx: number; cy: number }, sb: { cx: number; cy: number };
  let bBefore: Uint32Array;
  const count = (pred: (t: number) => boolean): number => {
    let n = 0;
    for (const v of A.chunk(s.cx, s.cy)) if (pred(v & LOMASK)) n++;
    return n;
  };

  /** Start a disaster in A's city: it is announced to A (an error toast ending in '!') and listed; then wait. */
  async function strike(kind: Disaster, name: string, waitTicks: number): Promise<void> {
    const n = A.toasts.length,
      seenBefore = seen(A).length;
    A.sendRaw({ t: 'devDisaster', kind });
    await sleep(400);
    const toasts = A.toasts.slice(n);
    expect(
      toasts.some((t) => t.kind === 'error' && t.msg.endsWith('!')),
      `${name} announced (${A.toastText(n)})`,
    ).toBe(true);
    expect(
      seen(A)
        .slice(seenBefore)
        .some((d) => d.kind === kind && d.ownerId === A.id),
      `${name} in the disasters list`,
    ).toBe(true);
    await sleep(waitTicks * TICK);
  }

  beforeAll(async () => {
    await resetServer();
    A = await TestClient.connect('Stricken', { v: 'test' });
    B = await TestClient.connect('Neighbour', { v: 'test' });
  });

  it('builds a town on a coastal plot, next to a neighbour', async () => {
    // a coastal plot: low land by the sea, for the flood
    s = (await A.findFree(...at('coast')))!;
    await A.subscribe([
      [s.cx, s.cy],
      [s.cx + 1, s.cy],
    ]);
    await A.claim(s.cx, s.cy);
    sb = (await B.findFree(s.cx + 1, s.cy))!;
    await B.claim(sb.cx, sb.cy);
    await B.subscribe([[sb.cx, sb.cy]]);
    A.sendRaw({ t: 'devFunds', amount: 200000 });
    await sleep(200);
    // a town on A's plot: a power line grid and residential zones on dry land
    const a = A.chunk(s.cx, s.cy);
    const dry = (x: number, y: number): boolean => !isWater(a[y * CHUNK + x]);
    // (builds are rate-limited per socket, so pace them like a player painting)
    for (let y = 2; y < 62; y += 5)
      for (let x = 2; x < 62; x += 5) {
        if (!dry(x, y) || !dry(x - 1, y - 1) || !dry(x + 1, y + 1)) continue;
        A.send({ t: 'build', tool: 'residential', x: s.cx * CHUNK + x, y: s.cy * CHUNK + y });
        await sleep(30);
      }
    // a power line along the driest row between the zones (the plot's edge rows can be mostly sea)
    let wireY = 0,
      best = -1;
    for (let y = 0; y < 62; y += 5) {
      let d = 0;
      for (let x = 1; x < 63; x++) if (dry(x, y)) d++;
      if (d > best) {
        best = d;
        wireY = y;
      }
    }
    for (let x = 1; x < 63; x++)
      if (dry(x, wireY)) {
        A.send({ t: 'build', tool: 'wire', x: s.cx * CHUNK + x, y: s.cy * CHUNK + wireY });
        await sleep(30);
      }
    await sleep(1000);
    bBefore = B.chunk(sb.cx, sb.cy).slice();
  });

  it('a blizzard brings power lines down', { timeout: 60_000 }, async () => {
    // the blizzard first, while the power line is whole (an earthquake can take all of it down)
    const wires0 = count(isWire);
    await strike(Disaster.Blizzard, 'blizzard', 30);
    expect(count(isWire)).toBeLessThan(wires0);
  });

  it('an earthquake leaves rubble', async () => {
    const rubble0 = count(isRubble);
    await strike(Disaster.Earthquake, 'earthquake', 4);
    expect(count(isRubble)).toBeGreaterThan(rubble0);
  });

  it('a tornado moves', { timeout: 60_000 }, async () => {
    await strike(Disaster.Tornado, 'tornado', 4);
    const path = seen(A)
      .filter((d) => d.kind === Disaster.Tornado)
      .map((d) => `${d.x.toFixed(0)},${d.y.toFixed(0)}`);
    await sleep(30 * TICK);
    expect(new Set(path).size, 'spots the tornado moved through').toBeGreaterThanOrEqual(3);
  });

  it('a wildfire starts', async () => {
    await strike(Disaster.Wildfire, 'wildfire', 1);
  });

  it('a flood covers low land by the water and recedes', { timeout: 120_000 }, async () => {
    await strike(Disaster.Flood, 'flood', 8);
    expect(count(isFlood), 'flooded tiles after 8 steps (this plot should have low land by the water)').toBeGreaterThan(0);
    for (let k = 0; k < 120 && count(isFlood) > 0; k++) await sleep(TICK);
    expect(count(isFlood), 'flood tiles left after it receded').toBe(0);
  });

  it('a storm strikes', async () => {
    await strike(Disaster.Storm, 'storm', 6);
  });

  it("leaves the neighbour's plot alone, but tells its mayor", () => {
    expect(B.chunk(sb.cx, sb.cy), "disasters in A's city changed B's plot").toEqual(bBefore);
    const news = B.toasts.filter((t) => t.kind === 'info' && /earthquake|tornado|blizzard|flood|storm|wildfire/i.test(`${t.kind}: ${t.msg}`));
    expect(news.length, 'B heard about all 6 disasters').toBeGreaterThanOrEqual(6);
    expect(
      A.toasts.some((t) => t.kind === 'info' && /shook|touched down|buried|spreading|rising|hit/.test(`${t.kind}: ${t.msg}`) && !/devDisaster/.test(t.msg)),
      "A got the bystanders' news as well as its own",
    ).toBe(false);
  });
});
