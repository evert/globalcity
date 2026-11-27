// Regression: bulldozing a bridge, an underwater power line or underwater rail must leave water, never land.
import { describe, it, expect, beforeAll } from 'vitest';
import { CHUNK, LOMASK, RIVER, type ToolId } from '@globalcity/shared';
import { TestClient, resetServer } from './support/client.ts';

// coastal chunks: try a few until one has a row of three open-water tiles (id RIVER) away from its edges
const CANDIDATES: [number, number][] = [
  [128, 26],
  [126, 24],
  [140, 24],
  [72, 34],
  [66, 32],
  [228, 50],
];

describe('building on water and bulldozing it', () => {
  let c: TestClient;
  let row: { x: number; y: number };
  let cases: [ToolId, string, number][];
  beforeAll(async () => {
    await resetServer();
    c = await TestClient.connect('Dozer');
  });

  it('finds a claimable chunk with open water', async () => {
    let found: { x: number; y: number } | null = null;
    for (const [ccx, ccy] of CANDIDATES) {
      const spot = await c.findFree(ccx, ccy);
      if (!spot) continue;
      await c.subscribe([[spot.cx, spot.cy]]);
      const a = c.chunk(spot.cx, spot.cy);
      for (let y = 4; y < CHUNK - 4 && !found; y++)
        for (let x = 4; x < CHUNK - 6 && !found; x++) {
          let ok = true;
          for (let k = 0; k < 3; k++) if ((a[y * CHUNK + x + k * 2] & LOMASK) !== RIVER) ok = false;
          if (ok) found = { x: spot.cx * CHUNK + x, y: spot.cy * CHUNK + y };
        }
      if (found) {
        await c.claim(spot.cx, spot.cy);
        break;
      }
    }
    expect(found, 'a claimable chunk with open water').not.toBeNull();
    row = found!;
    c.sendRaw({ t: 'devFunds', amount: 10000 });
    cases = [
      ['road', 'bridge', row.x],
      ['wire', 'underwater power line', row.x + 2],
      ['rail', 'underwater rail', row.x + 4],
    ];
  });

  it('builds a bridge, an underwater power line and underwater rail', async () => {
    for (const [tool, , x] of cases) await c.build(tool, x, row.y);
    for (const [, what, x] of cases) expect(c.kind(x, row.y), `${what} built (${c.toastText()})`).not.toBe(RIVER);
  });

  it('leaves water when they are bulldozed', async () => {
    for (const [, , x] of cases) await c.build('bulldozer', x, row.y);
    for (const [, what, x] of cases) expect(c.kind(x, row.y), `bulldozing the ${what}`).toBe(RIVER);
  });
});
