// Abandoning a broke city: refused while the city has money or no lifeline debt; once broke and in debt the
// plots are released (unclaim broadcast), the mayor starts over ($20,000, no debt), and the ruins crumble
// (rubble appears) until someone claims a plot. Needs DEV_HOOKS=1.
import WebSocket from 'ws';
import { decodeChunk } from '@globalcity/shared';
const PORT = process.env.PORT, TICK = Number(process.env.TICK_MS) || 500;
const LOMASK = 0x3ff, isWater = (t) => t >= 2 && t <= 20, isRubble = (t) => t >= 44 && t <= 47;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => { console.log('FAIL:', m); process.exit(1); };
const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`); ws.binaryType = 'arraybuffer';
let me = null, stats = null, spot = null, chunk = null, welcomes = 0; const toasts = [], unclaims = [];
ws.on('message', (d, bin) => {
  if (bin) { const f = decodeChunk(d instanceof ArrayBuffer ? d : d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength)); chunk = { cx: f.cx, cy: f.cy, a: f.tiles }; return; }
  const m = JSON.parse(d.toString());
  if (m.t === 'welcome') { me = m.player; stats = m.stats; welcomes++; } else if (m.t === 'stats') stats = m.stats;
  else if (m.t === 'freeSpot') spot = m; else if (m.t === 'toast') toasts.push(`${m.kind}: ${m.msg}`);
  else if (m.t === 'unclaim') unclaims.push(`${m.cx},${m.cy}`);
  else if (m.t === 'tiles' && chunk) for (let i = 0; i < m.u.length; i += 3) { const x = m.u[i], y = m.u[i + 1]; if (Math.floor(x / 64) === chunk.cx && Math.floor(y / 64) === chunk.cy) chunk.a[(y % 64) * 64 + (x % 64)] = m.u[i + 2]; }
});
const send = (m) => ws.send(JSON.stringify(m));
const last = () => toasts[toasts.length - 1] ?? '';
await new Promise((r) => ws.on('open', r)); send({ t: 'hello', name: 'Unlucky Mayor', v: 'test' }); while (!me) await sleep(20);
send({ t: 'findFree', cx: 75, cy: 15 }); while (!spot) await sleep(20);
send({ t: 'sub', chunks: [[spot.cx, spot.cy]] }); while (!chunk) await sleep(20);
let X = -1, Y = -1;
for (let y = 3; y < 48 && X < 0; y++) for (let x = 3; x < 40 && X < 0; x++) {
  let ok = true; for (let dy = 0; dy < 12 && ok; dy++) for (let dx = 0; dx < 22; dx++) if (isWater(chunk.a[(y + dy) * 64 + x + dx] & LOMASK)) { ok = false; break; }
  if (ok) { X = spot.cx * 64 + x; Y = spot.cy * 64 + y; }
}
if (X < 0) fail('no dry site');
const key = `${spot.cx},${spot.cy}`;
send({ t: 'claim', cx: spot.cx, cy: spot.cy }); await sleep(400);
for (let x = X; x < X + 30; x++) { send({ t: 'build', tool: 'road', x, y: Y + 5 }); await sleep(30); }
for (let i = 0; i < 6; i++) { send({ t: 'build', tool: 'residential', x: X + 2 + i * 4, y: Y + 2 }); await sleep(40); }
await sleep(400);
send({ t: 'abandon' }); await sleep(300);
if (!/Only a broke city/.test(last())) fail('abandon should be refused with money: ' + last());
send({ t: 'devSetFunds', amount: 50 }); await sleep(300);
send({ t: 'abandon' }); await sleep(300);
if (!/Only a broke city/.test(last())) fail('abandon should be refused without a lifeline: ' + last());
send({ t: 'lifeline' }); await sleep(300);
if (stats.debt <= 0) fail('lifeline not taken');
send({ t: 'devSetFunds', amount: 50 }); await sleep(300);
const before = welcomes;
send({ t: 'abandon' }); await sleep(600);
console.log('abandoned:', last());
if (welcomes !== before + 1) fail('no fresh welcome');
if (stats.funds !== 20000 || stats.debt !== 0 || stats.chunks !== 0) fail('mayor not reset: ' + JSON.stringify({ funds: stats.funds, debt: stats.debt, chunks: stats.chunks }));
if (!unclaims.includes(key)) fail('plot not released');
// the ruins crumble: with ABANDON_DECAY_P per tile per tick, some rubble shows up within a few dozen ticks
const rubble = () => { let n = 0; for (let i = 0; i < 4096; i++) if (isRubble(chunk.a[i] & LOMASK)) n++; return n; };
const r0 = rubble(), t0 = Date.now();
while (rubble() <= r0 && Date.now() - t0 < 80 * TICK) await sleep(TICK);
console.log(`ruins: ${r0} -> ${rubble()} rubble tiles`);
if (rubble() <= r0) fail('the ruins did not crumble');
// claiming the plot again stops the decay
send({ t: 'claim', cx: spot.cx, cy: spot.cy }); await sleep(400);
const r1 = rubble(); await sleep(TICK * 20);
console.log(`after reclaiming: ${r1} -> ${rubble()} rubble tiles`);
if (rubble() > r1 + 2) fail('decay continued after the plot was claimed');
console.log('PASS'); process.exit(0);
