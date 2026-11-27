// The 'built' ack for builds with a seq: ok after the tiles that carry the change, not ok straight away for a
// refused or rate-limited build (after any ok one still waiting, to keep them in order), nothing without a seq.
import WebSocket from 'ws';
import { decodeChunk } from '@globalcity/shared';
const URL = `ws://127.0.0.1:${process.env.PORT}/ws`;
const CHUNK = 64,
  LOMASK = 0x3ff;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => {
  console.log('FAIL:', m);
  process.exit(1);
};
const ws = new WebSocket(URL);
ws.binaryType = 'arraybuffer';
let me = null,
  spot = null,
  chunk = null;
const log = []; // every 'tiles' and 'built' message, in arrival order
const toasts = [];
ws.on('message', (d, bin) => {
  if (bin) {
    const f = decodeChunk(d instanceof ArrayBuffer ? d : d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));
    chunk = { cx: f.cx, cy: f.cy, a: f.tiles };
    return;
  }
  const m = JSON.parse(d.toString());
  if (m.t === 'welcome') me = m.player;
  else if (m.t === 'freeSpot') spot = m;
  else if (m.t === 'toast') toasts.push(m.msg);
  else if (m.t === 'tiles' || m.t === 'built') log.push(m);
  if (m.t === 'tiles' && chunk)
    for (let i = 0; i < m.u.length; i += 3) {
      const x = m.u[i],
        y = m.u[i + 1];
      if (Math.floor(x / CHUNK) === chunk.cx && Math.floor(y / CHUNK) === chunk.cy) chunk.a[(y % CHUNK) * CHUNK + (x % CHUNK)] = m.u[i + 2];
    }
});
const send = (m) => ws.send(JSON.stringify(m));
const waitFor = async (pred, ms = 3000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const i = log.findIndex(pred);
    if (i >= 0) return i;
    await sleep(10);
  }
  return -1;
};
await new Promise((r) => ws.on('open', r));
send({ t: 'hello', name: 'Acker' });
while (!me) await sleep(20);
send({ t: 'findFree', cx: 132, cy: 28 });
while (!spot) await sleep(20);
send({ t: 'sub', chunks: [[spot.cx, spot.cy]] });
while (!chunk) await sleep(20);
send({ t: 'claim', cx: spot.cx, cy: spot.cy });
await sleep(300);
send({ t: 'devFunds', amount: 20000 });
await sleep(300);
let X = -1,
  Y = -1;
for (let y = 4; y < 60 && X < 0; y++)
  for (let x = 4; x < 60 && X < 0; x++)
    if ((chunk.a[y * CHUNK + x] & LOMASK) === 0) {
      X = spot.cx * CHUNK + x;
      Y = spot.cy * CHUNK + y;
    }
if (X < 0) fail('no dirt tile');

// 1. ok: the ack comes after a 'tiles' message holding the new road
log.length = 0;
send({ t: 'build', tool: 'road', x: X, y: Y, seq: 1 });
const ack = await waitFor((m) => m.t === 'built' && m.seq === 1);
if (ack < 0) fail('no ack for seq 1');
if (!log[ack].ok) fail(`seq 1 not ok (${toasts.slice(-1)})`);
const tilesAt = log.findIndex((m) => m.t === 'tiles' && m.u.some((_, i) => i % 3 === 0 && m.u[i] === X && m.u[i + 1] === Y));
if (tilesAt < 0 || tilesAt > ack) fail(`tiles for the road (${tilesAt}) did not come before the ack (${ack})`);
console.log('ok ack after the tiles');

// 2. refused (unclaimed land, and a road on a road): not ok
log.length = 0;
const outside = (spot.cx + 1) * CHUNK + 5;
send({ t: 'build', tool: 'road', x: outside, y: Y, seq: 2 });
send({ t: 'build', tool: 'road', x: X, y: Y, seq: 3 });
if ((await waitFor((m) => m.t === 'built' && m.seq === 3)) < 0) fail('no ack for seq 3');
const a2 = log.find((m) => m.t === 'built' && m.seq === 2),
  a3 = log.find((m) => m.t === 'built' && m.seq === 3);
if (!a2 || a2.ok) fail('build on unclaimed land acked ok');
if (a3.ok) fail('road on a road acked ok');
console.log('refused builds acked not ok');

// 3. no seq: no ack
log.length = 0;
send({ t: 'build', tool: 'road', x: X + 1, y: Y });
send({ t: 'build', tool: 'road', x: outside, y: Y });
await sleep(600);
if (log.some((m) => m.t === 'built')) fail('ack sent for a build without seq');
if (!log.some((m) => m.t === 'tiles')) fail('the build without seq did nothing');
console.log('no ack without seq');

// 4. a burst past the rate limit: every seq is acked once, in order, the dropped ones not ok. The first one
// bulldozes the road from step 1 (its ack waits for the tiles), the rest find dirt: refused, yet acked after it.
log.length = 0;
const N = 150;
// (corked: one write, so the server handles the whole burst before its tile flush runs)
ws._socket.cork();
for (let i = 0; i < N; i++) send({ t: 'build', tool: 'bulldozer', x: X, y: Y, seq: 100 + i });
ws._socket.uncork();
await waitFor((m) => m.t === 'built' && m.seq === 100 + N - 1);
await sleep(200);
const seqs = log.filter((m) => m.t === 'built').map((m) => m.seq);
if (seqs.length !== N || seqs.some((s, i) => s !== 100 + i)) fail(`burst acks out of order or missing: ${seqs.length}`);
if (!toasts.some((t) => t.includes('too fast'))) fail('the burst did not hit the rate limit');
const burst = log.filter((m) => m.t === 'built');
if (!burst[0].ok || burst.slice(1).some((m) => m.ok)) fail(`burst: expected only the first ok, got ${burst.filter((m) => m.ok).map((m) => m.seq)}`);
console.log(`burst of ${N}: ${seqs.length} acks in order`);
console.log('PASS');
process.exit(0);
