// Two mayors with powered airports: both get the airport boost, the server publishes both airports, and the shared
// schedule produces flights between them only.
import { describe, it, expect, beforeAll } from 'vitest';
import { CHUNK, activeFlights, chunkKey, isWater, type ServerMsg } from '@globalcity/shared';
import { TestClient, resetServer, sleep, waitFor, TICK } from './support/client.ts';
import { at } from './support/fixture.ts';

/** The last 'airports' message a client got (the list and the server clock). */
const airportsMsg = (c: TestClient): Extract<ServerMsg, { t: 'airports' }> | undefined =>
  [...c.log].reverse().find((m): m is Extract<ServerMsg, { t: 'airports' }> => m.t === 'airports');

/** Found a city near (cx, cy), unlock airports and build a coal plant, a wire and an airport on the first dry 13x8
 *  block (offsets 2..49). Returns the airport's position. */
async function airportCity(c: TestClient, cx: number, cy: number): Promise<{ x: number; y: number }> {
  const spot = await c.findFree(cx, cy);
  if (!spot) throw new Error(`no free plot near ${cx},${cy}`);
  // subscribe and claim at once, as before
  c.send({ t: 'sub', chunks: [[spot.cx, spot.cy]] });
  c.send({ t: 'claim', cx: spot.cx, cy: spot.cy });
  const tiles = await waitFor(() => c.chunks.get(chunkKey(spot.cx, spot.cy)), 'chunk frame');
  c.sendRaw({ t: 'devFunds', amount: 100000 });
  c.sendRaw({ t: 'devPeak', pop: 1100000 }); // airports unlock at 1,000,000 people
  for (let y = 2; y < 50; y++)
    for (let x = 2; x < 50; x++) {
      let ok = true;
      for (let dy = 0; dy < 8 && ok; dy++)
        for (let dx = 0; dx < 13; dx++)
          if (isWater(tiles[(y + dy) * CHUNK + x + dx])) {
            ok = false;
            break;
          }
      if (!ok) continue;
      const X = spot.cx * CHUNK + x,
        Y = spot.cy * CHUNK + y;
      await c.build('coal', X + 1, Y + 1);
      await c.build('wire', X + 4, Y + 1);
      await c.build('airport', X + 6, Y + 1);
      return { x: X + 6, y: Y + 1 };
    }
  throw new Error(`no dry block for ${c.name}`);
}

describe('flights', () => {
  let A: TestClient, B: TestClient;
  beforeAll(async () => {
    await resetServer();
    A = await TestClient.connect('Pilot-A');
    B = await TestClient.connect('Pilot-B');
  });

  it('a lone airport gets no boost', async () => {
    await airportCity(A, ...at('coast'));
    await sleep(TICK * 4);
    const others = (A.airports ?? []).filter((p) => p.ownerId !== A.id).length;
    // (a fresh server has no other mayors' airports, so this always applies)
    expect(others).toBe(0);
    expect(A.stats!.specials.airport).toBe(0);
  });

  it('two connected airports both count and are published', async () => {
    await airportCity(B, ...at('farCoast'));
    const t0 = Date.now();
    while (Date.now() - t0 < 15000 && !(A.airports?.some((p) => p.ownerId === B.id) && A.stats!.specials.airport === 1 && B.stats!.specials.airport === 1))
      await sleep(100);
    expect(
      A.airports?.some((p) => p.ownerId === A.id),
      "A's airport published",
    ).toBe(true);
    expect(
      A.airports?.some((p) => p.ownerId === B.id),
      "B's airport published",
    ).toBe(true);
    expect(A.stats!.specials.airport).toBe(1);
    expect(B.stats!.specials.airport).toBe(1);
  });

  it('the schedule flies between them only', () => {
    const msg = airportsMsg(A)!;
    let n = 0,
      bad = 0;
    const seen = new Set<string>();
    for (let t = 0; t < 600_000; t += 500)
      for (const f of activeFlights(msg.airports, msg.now + t)) {
        if (seen.has(f.key)) continue;
        seen.add(f.key);
        n++;
        if (f.fromX === f.toX && f.fromY === f.toY) bad++;
      }
    expect(n, 'flights over the next 10 minutes').toBeGreaterThan(0);
    expect(bad, 'same-airport flights').toBe(0);
  });
});
