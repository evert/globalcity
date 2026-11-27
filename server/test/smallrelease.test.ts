// A city with fewer than SMALL_CITY_MAX_ITEMS things built is released once its mayor has been away
// SMALL_CITY_RELEASE_MS; a city with more is kept; the mayor is told why on the next visit. What was built on
// the released plot stays there for the next claimant.
import { describe, it, expect, beforeAll } from 'vitest';
import { CHUNK } from '@globalcity/shared';
import { TestClient, resetServer, sleep, TICK } from './support/client.ts';

const WAIT = 3000;

/** findFree near (cx, cy) and claim what it answers. */
async function settleAt(c: TestClient, cx: number, cy: number): Promise<{ cx: number; cy: number }> {
  const spot = await c.findFree(cx, cy);
  if (!spot) throw new Error(`no free chunk near ${cx},${cy}`);
  await c.claim(spot.cx, spot.cy);
  return spot;
}

describe('small city release', () => {
  let W: TestClient, S: TestClient, B: TestClient;
  let s: { cx: number; cy: number }, b: { cx: number; cy: number };
  let sId: string, sTok: string;
  beforeAll(async () => {
    await resetServer({ smallCityReleaseMs: WAIT });
    W = await TestClient.connect('Watcher');
    S = await TestClient.connect('Small');
    B = await TestClient.connect('Builder');
  });

  it('releases the small city of a mayor who left, not the bigger one', async () => {
    s = await settleAt(S, 140, 28);
    b = await settleAt(B, 180, 40);
    // Small builds 3 road tiles; Builder builds 6
    for (let k = 0; k < 3; k++) expect((await S.build('road', s.cx * CHUNK + 10 + k, s.cy * CHUNK + 10)).ok).toBe(true);
    for (let k = 0; k < 6; k++) expect((await B.build('road', b.cx * CHUNK + 10 + k, b.cy * CHUNK + 10)).ok).toBe(true);
    sId = S.id;
    sTok = S.token;
    await S.close();
    await B.close();
    const sKey = `${s.cx},${s.cy}`,
      bKey = `${b.cx},${b.cy}`;
    const t0 = Date.now();
    while (Date.now() - t0 < WAIT + 8 * TICK && !W.unclaims.includes(sKey)) {
      W.send({ t: 'ping' });
      await sleep(TICK);
    }
    expect(W.unclaims, 'the small city was released').toContain(sKey);
    for (let k = 0; k < 4; k++) {
      W.send({ t: 'ping' });
      await sleep(TICK);
    }
    expect(W.unclaims, 'the city with 6 things built is kept').not.toContain(bKey);
  });

  it('leaves the released plot its roads, unowned', async () => {
    for (let k = 0; k < 3; k++) {
      const q = await W.query(s.cx * CHUNK + 10 + k, s.cy * CHUNK + 10);
      expect(q.name, `road ${k}`).toBe('Road');
      expect(q.owner, `road ${k} owner`).toBeFalsy();
    }
  });

  it('tells the returning mayor why, once', async () => {
    const S2 = await TestClient.connect('Small', { resume: { id: sId, token: sTok } });
    await sleep(400);
    expect(
      S2.toasts.some((t) => /released because fewer than 5/.test(t.msg)),
      `notice on return (got: ${S2.toastText()})`,
    ).toBe(true);
    const S3 = await TestClient.connect('Small', { resume: { id: sId, token: sTok } });
    await sleep(400);
    expect(
      S3.toasts.some((t) => /released because/.test(t.msg)),
      'notice shown twice',
    ).toBe(false);
  });
});
