// Underwater power lines turn corners: an L-shaped run gets a corner piece, the straights keep their axis,
// and bulldozing the corner leaves water.
import { describe, it, expect, beforeAll } from 'vitest';
import { CHUNK, LOMASK, RIVER } from '@globalcity/shared';
import { TestClient, resetServer } from './support/client.ts';

// coastal chunks: find a 4x4 block of open water (id RIVER) away from the chunk edges
const CANDIDATES: [number, number][] = [
  [128, 26],
  [126, 24],
  [140, 24],
  [72, 34],
  [66, 32],
  [228, 50],
];
const NS = 208,
  EW = 209,
  NE = 1019,
  SE = 1020,
  SW = 1021,
  NW = 1022;

describe('underwater power line corners', () => {
  let c: TestClient;
  let at: { x: number; y: number };
  const id = (x: number, y: number): number => c.kind(at.x + x, at.y + y);
  /** [x, y, expected tile id] relative to `at` */
  const tilesAre = (want: [number, number, number][], what: string): void => {
    for (const [x, y, t] of want) expect(id(x, y), `${what}: tile ${x},${y} (${c.toastText()})`).toBe(t);
  };
  const wire = async (cells: [number, number][]): Promise<void> => {
    for (const [x, y] of cells) await c.build('wire', at.x + x, at.y + y);
  };

  beforeAll(async () => {
    await resetServer();
    c = await TestClient.connect('Cable layer');
  });

  it('finds a claimable chunk with open water', async () => {
    let found: { x: number; y: number } | null = null;
    for (const [ccx, ccy] of CANDIDATES) {
      const spot = await c.findFree(ccx, ccy);
      if (!spot) continue;
      await c.subscribe([[spot.cx, spot.cy]]);
      const a = c.chunk(spot.cx, spot.cy);
      const open = (x: number, y: number): boolean => (a[y * CHUNK + x] & LOMASK) === RIVER;
      for (let y = 4; y < CHUNK - 8 && !found; y++)
        for (let x = 4; x < CHUNK - 8 && !found; x++) {
          let ok = true;
          for (let dy = -1; dy < 4; dy++) for (let dx = -1; dx < 4; dx++) if (!open(x + dx, y + dy)) ok = false;
          if (ok) found = { x: spot.cx * CHUNK + x, y: spot.cy * CHUNK + y };
        }
      if (found) {
        await c.claim(spot.cx, spot.cy);
        break;
      }
    }
    expect(found, 'a claimable chunk with open water').not.toBeNull();
    at = found!;
    c.sendRaw({ t: 'devFunds', amount: 10000 });
  });

  it('turns an L-shaped run with a corner piece', async () => {
    // east along the top row, then south down the right column: ─ ─ ┐ │ │
    await wire([
      [0, 0],
      [1, 0],
      [2, 0],
      [2, 1],
      [2, 2],
    ]);
    tilesAre(
      [
        [0, 0, EW],
        [1, 0, EW],
        [2, 0, SW],
        [2, 1, NS],
        [2, 2, NS],
      ],
      'L-shaped run',
    );
  });

  it('closes a square with four corners', async () => {
    // west along the bottom, north up the left column
    await wire([
      [1, 2],
      [0, 2],
      [0, 1],
    ]);
    tilesAre(
      [
        [0, 0, SE],
        [2, 0, SW],
        [2, 2, NW],
        [0, 2, NE],
        [1, 0, EW],
        [1, 2, EW],
        [0, 1, NS],
        [2, 1, NS],
      ],
      'closed square',
    );
  });

  it('leaves water when a corner is bulldozed', async () => {
    // the corners conduct: a coal plant is not needed, only that the pieces count as wires (isWire), so bulldoze one
    await c.build('bulldozer', at.x + 2, at.y);
    expect(id(2, 0), 'bulldozed corner').toBe(RIVER);
    tilesAre(
      [
        [1, 0, EW],
        [2, 1, NS],
      ],
      'neighbours after removing a corner',
    );
  });
});
