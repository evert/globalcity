// Lifeline: refused with money, offered when broke, grants LIFELINE_AMOUNT as debt, stacks for early cities up to the cap, one at a time for bigger ones,
// and is repaid from surplus months. Needs DEV_HOOKS=1.
import WebSocket from 'ws';
import { decodeChunk } from '@globalcity/shared';
const PORT = process.env.PORT,
  TICK = Number(process.env.TICK_MS) || 500;
const CHUNK = 64,
  LOMASK = 0x3ff,
  isWater = (t) => t >= 2 && t <= 20;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => {
  console.log('FAIL:', m);
  process.exit(1);
};
const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
ws.binaryType = 'arraybuffer';
let me = null,
  stats = null,
  spot = null,
  chunk = null;
const toasts = [];
ws.on('message', (d, bin) => {
  if (bin) {
    const f = decodeChunk(d instanceof ArrayBuffer ? d : d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));
    chunk = { cx: f.cx, cy: f.cy, a: f.tiles };
    return;
  }
  const m = JSON.parse(d.toString());
  if (m.t === 'welcome') {
    me = m.player;
    stats = m.stats;
  } else if (m.t === 'stats') stats = m.stats;
  else if (m.t === 'freeSpot') spot = m;
  else if (m.t === 'toast') toasts.push(`${m.kind}: ${m.msg}`);
});
const send = (m) => ws.send(JSON.stringify(m));
const last = () => toasts[toasts.length - 1] ?? '';
await new Promise((r) => ws.on('open', r));
send({ t: 'hello', name: 'Broke Mayor', v: 'test' });
while (!me) await sleep(20);
send({ t: 'findFree', cx: 150, cy: 30 });
while (!spot) await sleep(20);
send({ t: 'sub', chunks: [[spot.cx, spot.cy]] });
while (!chunk) await sleep(20);
let X = -1,
  Y = -1;
for (let y = 3; y < 48 && X < 0; y++)
  for (let x = 3; x < 40 && X < 0; x++) {
    let ok = true;
    for (let dy = 0; dy < 12 && ok; dy++)
      for (let dx = 0; dx < 22; dx++)
        if (isWater(chunk.a[(y + dy) * 64 + x + dx] & LOMASK)) {
          ok = false;
          break;
        }
    if (ok) {
      X = spot.cx * 64 + x;
      Y = spot.cy * 64 + y;
    }
  }
if (X < 0) fail('no dry site');
send({ t: 'claim', cx: spot.cx, cy: spot.cy });
await sleep(400);
send({ t: 'lifeline' });
await sleep(300);
console.log('with $20,000:', last());
if (!/only for cities with less than/.test(last())) fail('lifeline should be refused with money');
// a small working town: plant, wires, houses, a road
const build = async (tool, x, y) => {
  send({ t: 'build', tool, x, y });
  await sleep(40);
};
await build('coal', X + 1, Y + 1);
for (let x = X + 4; x < X + 20; x++) await build('wire', x, Y + 1);
for (let i = 0; i < 5; i++) await build('residential', X + 5 + i * 3, Y + 3);
await build('commercial', X + 5, Y + 7);
await build('industrial', X + 8, Y + 7);
for (let x = X; x < X + 21; x++) await build('road', x, Y + 5);
send({ t: 'devSetFunds', amount: 500 });
await sleep(300);
console.log('broke: funds', stats.funds, '| lifeline offered', stats.lifelineAvailable);
if (!stats.lifelineAvailable) fail('lifeline should be offered at $500');
const before = stats.funds;
send({ t: 'lifeline' });
await sleep(300);
console.log('took it:', last(), '| funds', stats.funds, '| debt', stats.debt);
// (a month of upkeep can land in between, so allow a small difference)
if (Math.abs(stats.funds - before - 10000) > 100 || stats.debt !== 10000 || stats.lifelineAvailable) fail('lifeline grant');
// an early city (peak below 2,000) may stack lifelines while repaying, up to $30,000 owed
for (const owed of [20000, 30000]) {
  send({ t: 'devSetFunds', amount: 100 });
  await sleep(200);
  if (!stats.lifelineAvailable) fail(`early city should be offered another lifeline at debt ${stats.debt}`);
  send({ t: 'lifeline' });
  await sleep(300);
  console.log('another one:', last(), '| debt', stats.debt);
  if (stats.debt !== owed) fail(`stacked lifeline: debt ${stats.debt}, expected ${owed}`);
}
send({ t: 'devSetFunds', amount: 100 });
await sleep(200);
if (stats.lifelineAvailable) fail('no lifeline beyond $30,000 owed');
send({ t: 'lifeline' });
await sleep(300);
console.log('over the cap:', last());
if (!/the limit is \$30,000/.test(last())) fail('lifeline over the debt cap should be refused');
// a bigger city must repay first
send({ t: 'devPeak', pop: 5000 });
await sleep(600);
send({ t: 'lifeline' });
await sleep(300);
const reply = [...toasts].reverse().find((t) => t.startsWith('error:')) ?? '';
console.log('bigger city:', reply);
if (!/Repay your current lifeline first/.test(reply)) fail('a bigger city in debt should be refused');
send({ t: 'devSetFunds', amount: 10500 });
await sleep(200);
// a small town runs at a loss for a while: loss months must leave the debt untouched
for (let k = 0; k < 20; k++) {
  send({ t: 'ping' });
  await sleep(TICK);
}
console.log(`20 months later: debt ${stats.debt}, last year ${stats.lastIncome}`);
if (stats.debt !== 30000) fail('debt changed during loss months');
// repayment arithmetic (the same function the simulation calls every month): a share of a surplus month's
// operating result is paid from funds, loss months leave the debt alone
const { repayLifeline } = await import('../src/players.ts');
const fake = (funds, debt) => ({ funds, debt, stats: {}, chunks: [], peakPop: 0 });
const p = fake(1000, 10000);
const r1 = repayLifeline(p, 400); // surplus: a quarter repays
const r2 = repayLifeline(p, -300); // loss: debt untouched
const q = fake(50, 30);
const r3 = repayLifeline(q, 1000); // last bit of debt cleared
console.log(
  `surplus $400 -> repaid ${r1.repaid}; loss $300 -> repaid ${r2.repaid}, debt ${p.debt}, funds ${p.funds}; final $30 -> cleared ${r3.cleared}, funds ${q.funds}`,
);
if (r1.repaid !== 100 || r2.repaid !== 0 || p.debt !== 9900 || p.funds !== 900 || !r3.cleared || q.debt !== 0 || q.funds !== 20) fail('repayment arithmetic');
console.log('PASS');
process.exit(0);
