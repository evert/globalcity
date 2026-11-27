// A city whose mayor goes quiet freezes (no growth/decline, no budget); a neighbour keeps drawing power
// from its plant; the city resumes when the mayor is back.
import { describe, it, expect, beforeAll } from 'vitest';
import { CHUNK, isWater, type PlayerStats } from '@globalcity/shared';
import { TestClient, resetServer, sleep, TICK } from './support/client.ts';
import { at } from './support/fixture.ts';

const FREEZE = 4000;
const CANDIDATES: [number, number][] = [at('inland'), at('east')];

describe('frozen cities', () => {
  let A: TestClient, B: TestClient;
  beforeAll(async () => {
    await resetServer({ cityFreezeMs: FREEZE });
    A = await TestClient.connect('Away-A');
    B = await TestClient.connect('Neighbour-B');
  });

  it('builds two neighbouring towns, one powered by the other', { timeout: 60 * TICK + 30_000 }, async () => {
    // two adjacent free chunks with a dry band across the border
    let site: { cx: number; cy: number; Y: number } | null = null;
    for (const [ccx, ccy] of CANDIDATES) {
      const a = await A.findFree(ccx, ccy);
      if (!a) continue;
      const b = await B.findFree(a.cx + 1, a.cy);
      if (!b || b.cx !== a.cx + 1 || b.cy !== a.cy) continue;
      await A.subscribe([[a.cx, a.cy]]);
      await B.subscribe([[a.cx + 1, a.cy]]);
      const ca = A.chunk(a.cx, a.cy),
        cb = B.chunk(a.cx + 1, a.cy);
      for (let y = 4; y < 50 && !site; y++) {
        let ok = true;
        for (let dy = 0; dy < 10 && ok; dy++) {
          for (let x = 40; x < 64; x++) if (isWater(ca[(y + dy) * 64 + x])) ok = false;
          for (let x = 0; x < 16; x++) if (isWater(cb[(y + dy) * 64 + x])) ok = false;
        }
        if (ok) site = { cx: a.cx, cy: a.cy, Y: a.cy * 64 + y };
      }
      if (site) break;
    }
    expect(site, 'an adjacent dry site').not.toBeNull();
    const { cx, cy, Y } = site!,
      AX = (cx + 1) * CHUNK - 24,
      BX = (cx + 1) * CHUNK;
    await A.claim(cx, cy);
    await B.claim(cx + 1, cy);
    A.sendRaw({ t: 'devFunds', amount: 50000 });
    B.sendRaw({ t: 'devFunds', amount: 50000 });
    await A.build('coal', AX + 1, Y + 1);
    for (let x = AX + 4; x < BX; x++) await A.build('wire', x, Y + 1);
    for (let i = 0; i < 4; i++) await A.build('residential', AX + 5 + i * 4, Y + 4);
    for (let x = AX; x < BX; x++) await A.build('road', x, Y + 6);
    for (let x = BX; x < BX + 3; x++) await B.build('wire', x, Y + 1);
    await B.build('residential', BX + 4, Y + 1);
    await B.build('residential', BX + 8, Y + 1);
    for (let x = BX; x < BX + 12; x++) await B.build('road', x, Y + 3);
    // let A grow while A keeps "playing" (pings)
    const t0 = Date.now();
    while (Date.now() - t0 < 60 * TICK && !((A.stats?.population ?? 0) > 0 && (B.stats?.powerImported ?? 0) > 0)) {
      A.send({ t: 'ping' });
      B.send({ t: 'ping' });
      await sleep(TICK);
    }
    expect(A.stats!.population, 'A grew').toBeGreaterThan(0);
    expect(B.stats!.powerImported, 'B imports power from A').toBeGreaterThan(0);
  });

  it("freezes the quiet mayor's city, and the neighbour keeps its power", { timeout: FREEZE + 20 * TICK + 10_000 }, async () => {
    // A goes quiet; B keeps pinging
    const quietAt = Date.now();
    while (Date.now() - quietAt < FREEZE + 2 * TICK) {
      B.send({ t: 'ping' });
      await sleep(TICK);
    }
    const frozenStats = JSON.stringify(A.stats),
      msgs = A.statsCount;
    for (let k = 0; k < 8; k++) {
      B.send({ t: 'ping' });
      await sleep(TICK);
    }
    const a = JSON.parse(frozenStats) as Record<string, unknown>,
      b = A.stats as unknown as Record<string, unknown>;
    const changed = Object.keys(b)
      .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
      .map((k) => `${k} ${JSON.stringify(a[k])} -> ${JSON.stringify(b[k])}`);
    expect(A.statsCount - msgs, 'stats messages to the frozen city').toBe(0);
    expect(changed, 'the frozen city changed').toEqual([]);
    expect((B.stats as PlayerStats).powerImported, 'the neighbour keeps power while A is frozen').toBeGreaterThan(0);
  });

  it('resumes the city when its mayor is back', async () => {
    const m0 = A.statsCount;
    for (let k = 0; k < 10 && A.statsCount === m0; k++) {
      A.send({ t: 'ping' });
      B.send({ t: 'ping' });
      await sleep(TICK);
    }
    expect(A.statsCount, 'the city resumed').toBeGreaterThan(m0);
  });
});
