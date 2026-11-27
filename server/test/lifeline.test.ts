// Lifeline: refused with money, offered when broke, grants LIFELINE_AMOUNT as debt, stacks for early cities up to
// the cap, one at a time for bigger ones, and is repaid from surplus months.
import { describe, it, expect, beforeAll } from 'vitest';
import type { ToolId } from '@globalcity/shared';
import { repayLifeline, type PlayerRecord } from '../src/players.ts';
import { TestClient, resetServer, settle, sleep, TICK } from './support/client.ts';
import { at } from './support/fixture.ts';

describe('lifeline', () => {
  let c: TestClient;
  let X = 0,
    Y = 0;
  const last = (): string => {
    const t = c.toasts[c.toasts.length - 1];
    return t ? `${t.kind}: ${t.msg}` : '';
  };
  const lifeline = async (): Promise<void> => {
    c.send({ t: 'lifeline' });
    await sleep(300);
  };
  const setFunds = async (amount: number, ms: number): Promise<void> => {
    c.sendRaw({ t: 'devSetFunds', amount });
    await sleep(ms);
  };

  beforeAll(async () => {
    await resetServer();
    c = await TestClient.connect('Broke Mayor', { v: 'test' });
  });

  it('is refused to a city with money', async () => {
    // only the nearest free plot to 150,30: a dry 22x12 site at offsets 3..39, 3..47
    const site = await settle(c, [at('inland')], 22, 12, { x0: 3, x1: 39, y0: 3, y1: 47 });
    ({ x: X, y: Y } = site);
    await sleep(400);
    await lifeline();
    expect(last()).toMatch(/only for cities with less than/);
  });

  it('is offered when broke and grants the money as debt', async () => {
    // a small working town: plant, wires, houses, a road
    const build = (tool: ToolId, x: number, y: number) => c.build(tool, x, y);
    await build('coal', X + 1, Y + 1);
    for (let x = X + 4; x < X + 20; x++) await build('wire', x, Y + 1);
    for (let i = 0; i < 5; i++) await build('residential', X + 5 + i * 3, Y + 3);
    await build('commercial', X + 5, Y + 7);
    await build('industrial', X + 8, Y + 7);
    for (let x = X; x < X + 21; x++) await build('road', x, Y + 5);
    await setFunds(500, 300);
    expect(c.stats!.lifelineAvailable, 'lifeline offered at $500').toBe(true);
    const before = c.stats!.funds;
    await lifeline();
    // (a month of upkeep can land in between, so allow a small difference)
    expect(Math.abs(c.stats!.funds - before - 10000)).toBeLessThanOrEqual(100);
    expect(c.stats!.debt).toBe(10000);
    expect(c.stats!.lifelineAvailable).toBe(false);
  });

  it('stacks for an early city up to $30,000 owed', async () => {
    // an early city (peak below 2,000) may stack lifelines while repaying
    for (const owed of [20000, 30000]) {
      await setFunds(100, 200);
      expect(c.stats!.lifelineAvailable, `another lifeline at debt ${c.stats!.debt}`).toBe(true);
      await lifeline();
      expect(c.stats!.debt).toBe(owed);
    }
    await setFunds(100, 200);
    expect(c.stats!.lifelineAvailable, 'no lifeline beyond $30,000 owed').toBe(false);
    await lifeline();
    expect(last()).toMatch(/the limit is \$30,000/);
  });

  it('makes a bigger city repay first', async () => {
    c.sendRaw({ t: 'devPeak', pop: 5000 });
    await sleep(600);
    await lifeline();
    const reply = [...c.toasts].reverse().find((t) => t.kind === 'error');
    expect(reply?.msg).toMatch(/Repay your current lifeline first/);
  });

  it('leaves the debt alone in loss months', { timeout: 60_000 }, async () => {
    await setFunds(10500, 200);
    // a small town runs at a loss for a while
    for (let k = 0; k < 20; k++) {
      c.send({ t: 'ping' });
      await sleep(TICK);
    }
    expect(c.stats!.debt).toBe(30000);
  });

  it('repays a share of surplus months', () => {
    // the same function the simulation calls every month: a share of a surplus month's operating result is paid
    // from funds, loss months leave the debt alone
    const fake = (funds: number, debt: number) => ({ funds, debt, stats: {}, chunks: [], peakPop: 0 }) as unknown as PlayerRecord;
    const p = fake(1000, 10000);
    const r1 = repayLifeline(p, 400); // surplus: a quarter repays
    const r2 = repayLifeline(p, -300); // loss: debt untouched
    const q = fake(50, 30);
    const r3 = repayLifeline(q, 1000); // last bit of debt cleared
    expect(r1.repaid).toBe(100);
    expect(r2.repaid).toBe(0);
    expect(p.debt).toBe(9900);
    expect(p.funds).toBe(900);
    expect(r3.cleared).toBe(true);
    expect(q.debt).toBe(0);
    expect(q.funds).toBe(20);
  });
});
