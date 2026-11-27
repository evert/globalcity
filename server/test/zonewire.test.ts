// Zones can be placed over overland power lines; power keeps flowing through the zone.
import { describe, it, expect, beforeAll } from 'vitest';
import { ZONEBIT } from '@globalcity/shared';
import { TestClient, resetServer, settle, sleep, TICK } from './support/client.ts';
import { at } from './support/fixture.ts';

describe('zones over power lines', () => {
  let c: TestClient;
  let X: number, Y: number;
  let funds0 = 0,
    clearing = 0;
  beforeAll(async () => {
    await resetServer();
    c = await TestClient.connect('Lineman');
  });

  it('runs a power line from a coal plant', async () => {
    // a dry 30x8 area
    const site = await settle(c, [at('inland')], 30, 8, { x0: 2, x1: 29, y0: 4, y1: 49 });
    X = site.x;
    Y = site.y;
    await sleep(300);
    c.sendRaw({ t: 'devFunds', amount: 20000 });
    await sleep(300);
    // coal plant occupies X..X+3, Y..Y+3 (hot-spot X+1,Y+1); line along row Y+1 from X+4 to X+24
    await c.build('coal', X + 1, Y + 1);
    for (let x = X + 4; x <= X + 24; x++) await c.build('wire', x, Y + 1);
    await sleep(500);
    funds0 = c.stats!.funds;
    // trees/rubble in the two footprints are auto-bulldozed at $1 each on top of the line tiles
    for (const zx of [X + 12, X + 26])
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const id = c.kind(zx + dx, Y + 1 + dy);
          if ((id >= 21 && id <= 39) || (id >= 44 && id <= 47)) clearing++;
        }
  });

  it('places a zone over the line, and one past its end', async () => {
    // residential zone centred on the line at X+12 (footprint X+11..X+13, rows Y..Y+2): crosses 3 wire tiles
    await c.build('residential', X + 12, Y + 1);
    // far zone just past the end of the line (footprint X+25..X+27)
    await c.build('residential', X + 26, Y + 1);
    await sleep(600);
    expect(c.tile(X + 26, Y + 1)! & ZONEBIT, `far zone placed (${c.toastText()})`).toBeTruthy();
    expect(c.tile(X + 12, Y + 1)! & ZONEBIT, `zone over the power line placed (${c.toastText()})`).toBeTruthy();
    const expected = 2 * 100 + 3 + clearing;
    // (monthly upkeep can land during the wait, so the cost is only checked as a lower bound)
    expect(funds0 - c.stats!.funds, `placement cost (2 zones, 3 line tiles, ${clearing} trees/rubble)`).toBeGreaterThanOrEqual(expected);
  });

  it('powers the far zone through the first one', async () => {
    let powered = false;
    for (let k = 0; k < 6 && !powered; k++) {
      await sleep(TICK);
      powered = (await c.query(X + 26, Y + 1)).powered;
    }
    expect(powered, 'power flows through the zone').toBe(true);
  });
});
