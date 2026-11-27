// Nature returns: rubble turns back into the landscape that was there before anyone built, but not while the
// city's mayor is playing.
import { describe, it, expect, beforeAll } from 'vitest';
import { CHUNK, isWater, isRubble } from '@globalcity/shared';
import { TestClient, resetServer, sleep } from './support/client.ts';
import { at } from './support/fixture.ts';

const FREEZE_MS = 3000;

/** The chunk's tiles as a fresh subscriber sees them now. */
async function snapshot(cx: number, cy: number): Promise<Uint32Array> {
  const o = await TestClient.connect('Observer', { v: 'test' });
  await o.subscribe([[cx, cy]]);
  const tiles = o.chunk(cx, cy).slice();
  await o.close();
  return tiles;
}

describe('regrow', () => {
  let A: TestClient;
  let cx: number, cy: number;
  let orig: Uint32Array;
  const site: number[] = [];
  const rubbleIn = (a: Uint32Array): number => site.filter((k) => isRubble(a[k])).length;
  const restoredIn = (a: Uint32Array): number => site.filter((k) => a[k] === orig[k]).length;

  beforeAll(async () => {
    await resetServer({ regrowMs: 1000, regrowP: 0.5, cityFreezeMs: FREEZE_MS });
    A = await TestClient.connect('Gardener', { v: 'test' });
  });

  it('bulldozed zones leave rubble', async () => {
    const spot = await A.findFree(...at('inland')); // inland, dry
    expect(spot).not.toBeNull();
    ({ cx, cy } = spot!);
    await A.subscribe([[cx, cy]]);
    orig = A.chunk(cx, cy).slice();
    // a dry 9x6 site for six residential zones
    let sx = -1,
      sy = -1;
    for (let y = 4; y < 50 && sx < 0; y++)
      for (let x = 4; x < 50 && sx < 0; x++) {
        let ok = true;
        for (let dy = 0; dy < 6 && ok; dy++)
          for (let dx = 0; dx < 9; dx++)
            if (isWater(orig[(y + dy) * CHUNK + x + dx])) {
              ok = false;
              break;
            }
        if (ok) {
          sx = x;
          sy = y;
        }
      }
    expect(sx, 'a dry site').toBeGreaterThanOrEqual(0);
    await A.claim(cx, cy);
    const X = cx * CHUNK + sx,
      Y = cy * CHUNK + sy;
    for (let j = 0; j < 2; j++) for (let i = 0; i < 3; i++) await A.build('residential', X + 1 + i * 3, Y + 1 + j * 3);
    for (let j = 0; j < 2; j++) for (let i = 0; i < 3; i++) await A.build('bulldozer', X + 1 + i * 3, Y + 1 + j * 3);
    for (let dy = 0; dy < 6; dy++) for (let dx = 0; dx < 9; dx++) site.push((sy + dy) * CHUNK + sx + dx);
    expect(rubbleIn(await snapshot(cx, cy)), 'the bulldozed zones are all rubble').toBe(site.length);
  });

  it('stays rubble while the mayor is playing', async () => {
    // several regrowth passes
    for (let i = 0; i < 8; i++) {
      A.send({ t: 'ping' });
      await sleep(500);
    }
    expect(rubbleIn(await snapshot(cx, cy))).toBe(site.length);
  });

  it('grows back to exactly what was there once the mayor has left', async () => {
    await A.close();
    await sleep(FREEZE_MS + 8000); // the city freezes, then a few regrowth passes
    const now = await snapshot(cx, cy);
    expect(rubbleIn(now), 'rubble left').toBeLessThanOrEqual(2);
    expect(restoredIn(now) + rubbleIn(now), 'regrown tiles match the original landscape').toBe(site.length);
  });
});
