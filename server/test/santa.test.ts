// Santa's sleigh: the server publishes the Christmas trees (the stops) only in December and only once at least 4
// stand.
import { describe, it, expect, beforeAll } from 'vitest';
import type { SantaTree } from '@globalcity/shared';
import { TestClient, resetServer, settle, sleep, waitFor, TICK } from './support/client.ts';
import { at } from './support/fixture.ts';

for (const month of [12, 11]) {
  describe(`Santa's stops (month ${month})`, () => {
    let c: TestClient;
    let X: number, Y: number;
    const trees = (): SantaTree[] => c.santa[c.santa.length - 1].trees;
    beforeAll(async () => {
      await resetServer({ seasonMonth: month });
      c = await TestClient.connect('Mayor-Santa', { v: 'test' });
    });

    it('has no stops before there are trees', async () => {
      await waitFor(() => c.santa.length > 0, 'santa on welcome');
      expect(trees()).toEqual([]);
    });

    it('needs at least 4 trees', async () => {
      const site = await settle(c, [at('inland'), at('east')], 16, 6, { x0: 2, x1: 39, y0: 2, y1: 49 });
      X = site.x;
      Y = site.y;
      c.sendRaw({ t: 'devFunds', amount: 100000 });
      await sleep(200);
      for (let k = 0; k < 3; k++) {
        c.sendRaw({ t: 'devPlace', tool: 'christmastree', x: X + 1 + k * 3, y: Y + 1 });
        await sleep(150);
      }
      await sleep(TICK * 3);
      expect(c.stats!.inSeason?.includes('christmastree') ?? false, 'in season').toBe(month === 12);
      expect(trees(), '3 trees are not enough for Santa').toEqual([]);
    });

    it(month === 12 ? 'flies to the tops of 4 trees in December' : 'does not fly outside December', async () => {
      c.sendRaw({ t: 'devPlace', tool: 'christmastree', x: X + 10, y: Y + 1 });
      await sleep(TICK * 3);
      if (month === 12) {
        expect(trees(), '4 trees in December: Santa flies').toHaveLength(4);
        expect(trees(), 'a stop is the top of a tree (footprint x+1, top row)').toContainEqual({ x: X + 1, y: Y });
      } else expect(trees(), 'outside December there is no Santa').toEqual([]);
    });
  });
}
