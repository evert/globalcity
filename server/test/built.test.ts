// The 'built' ack for builds with a seq: ok after the tiles that carry the change, not ok straight away for a
// refused or rate-limited build (after any ok one still waiting, to keep them in order), nothing without a seq.
// Builds are sent by hand here, with explicit seqs (TestClient.build numbers its own).
import type { Socket } from 'node:net';
import { describe, it, expect, beforeAll } from 'vitest';
import { CHUNK, LOMASK, type ServerMsg } from '@globalcity/shared';
import { TestClient, resetServer, sleep, waitFor } from './support/client.ts';

type Built = Extract<ServerMsg, { t: 'built' }>;
type Tiles = Extract<ServerMsg, { t: 'tiles' }>;

describe("'built' acks", () => {
  let c: TestClient;
  let X = -1,
    Y = -1,
    outside = 0;
  /** the 'tiles' and 'built' messages since `from` (an index into c.log) */
  const since = (from: number): (Built | Tiles)[] => c.log.slice(from).filter((m): m is Built | Tiles => m.t === 'tiles' || m.t === 'built');
  const ackIndex = (from: number, seq: number): number => since(from).findIndex((m) => m.t === 'built' && m.seq === seq);
  const waitAck = (from: number, seq: number, ms = 3000): Promise<number> =>
    waitFor(
      () => {
        const i = ackIndex(from, seq);
        return i >= 0 ? i + 1 : null; // (+1: 0 is a valid index)
      },
      `ack for seq ${seq}`,
      ms,
    ).then((i) => i - 1);

  beforeAll(async () => {
    await resetServer();
    c = await TestClient.connect('Acker');
    const spot = await c.findFree(132, 28);
    expect(spot).not.toBeNull();
    await c.subscribe([[spot!.cx, spot!.cy]]);
    await c.claim(spot!.cx, spot!.cy);
    c.sendRaw({ t: 'devFunds', amount: 20000 });
    await sleep(300);
    const a = c.chunk(spot!.cx, spot!.cy);
    for (let y = 4; y < 60 && X < 0; y++)
      for (let x = 4; x < 60 && X < 0; x++)
        if ((a[y * CHUNK + x] & LOMASK) === 0) {
          X = spot!.cx * CHUNK + x;
          Y = spot!.cy * CHUNK + y;
        }
    expect(X, 'a dirt tile').toBeGreaterThanOrEqual(0);
    outside = (spot!.cx + 1) * CHUNK + 5;
  });

  it('acks ok after the tiles holding the change', async () => {
    const from = c.log.length;
    c.send({ t: 'build', tool: 'road', x: X, y: Y, seq: 1 });
    const ack = await waitAck(from, 1);
    const log = since(from);
    expect((log[ack] as Built).ok, `seq 1 ok (${c.toastText()})`).toBe(true);
    const tilesAt = log.findIndex((m) => m.t === 'tiles' && m.u.some((_, i) => i % 3 === 0 && m.u[i] === X && m.u[i + 1] === Y));
    expect(tilesAt, 'tiles for the road').toBeGreaterThanOrEqual(0);
    expect(tilesAt, 'tiles for the road come before the ack').toBeLessThan(ack);
  });

  it('acks refused builds not ok', async () => {
    const from = c.log.length;
    c.send({ t: 'build', tool: 'road', x: outside, y: Y, seq: 2 }); // unclaimed land
    c.send({ t: 'build', tool: 'road', x: X, y: Y, seq: 3 }); // a road on a road
    await waitAck(from, 3);
    const log = since(from);
    const a2 = log.find((m): m is Built => m.t === 'built' && m.seq === 2),
      a3 = log.find((m): m is Built => m.t === 'built' && m.seq === 3);
    expect(a2, 'an ack for the build on unclaimed land').toBeDefined();
    expect(a2!.ok, 'build on unclaimed land').toBe(false);
    expect(a3!.ok, 'road on a road').toBe(false);
  });

  it('sends no ack without a seq', async () => {
    const from = c.log.length;
    c.send({ t: 'build', tool: 'road', x: X + 1, y: Y });
    c.send({ t: 'build', tool: 'road', x: outside, y: Y });
    await sleep(600);
    const log = since(from);
    expect(
      log.some((m) => m.t === 'built'),
      'an ack for a build without seq',
    ).toBe(false);
    expect(
      log.some((m) => m.t === 'tiles'),
      'the build without seq did something',
    ).toBe(true);
  });

  it('acks a burst past the rate limit once each, in order, the dropped ones not ok', async () => {
    // The first one bulldozes the road from the first test (its ack waits for the tiles), the rest find dirt:
    // refused, yet acked after it.
    const from = c.log.length,
      toasts = c.toasts.length;
    const N = 150;
    // (corked: one write, so the server handles the whole burst before its tile flush runs)
    const sock = (c.ws as unknown as { _socket: Socket })._socket;
    sock.cork();
    for (let i = 0; i < N; i++) c.send({ t: 'build', tool: 'bulldozer', x: X, y: Y, seq: 100 + i });
    sock.uncork();
    await waitAck(from, 100 + N - 1).catch(() => -1); // (checked below)
    await sleep(200);
    const burst = since(from).filter((m): m is Built => m.t === 'built');
    expect(
      burst.map((m) => m.seq),
      'every seq acked once, in order',
    ).toEqual(Array.from({ length: N }, (_, i) => 100 + i));
    expect(c.hasToast(/too fast/, toasts), 'the burst hit the rate limit').toBe(true);
    expect(
      burst.filter((m) => m.ok).map((m) => m.seq),
      'only the first is ok',
    ).toEqual([100]);
  });
});
