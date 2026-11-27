// Santa's sleigh: the server publishes the Christmas trees (the stops) only in December and only once at least 4
// stand. Run twice by run-all.sh: santa (SEASON_MONTH=12) and santa_off (SEASON_MONTH=11). Needs DEV_HOOKS=1.
import WebSocket from 'ws';
import { decodeChunk } from '@globalcity/shared';
const PORT = process.env.PORT, TICK = Number(process.env.TICK_MS) || 500;
const LOMASK = 0x3ff, isWater = (t) => t >= 2 && t <= 20;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => { console.log('FAIL:', m); process.exit(1); };
const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`); ws.binaryType = 'arraybuffer';
let id = null, stats = null, spot = null, chunk = null, santa = null;
ws.on('message', (d, bin) => {
  if (bin) { const f = decodeChunk(d instanceof ArrayBuffer ? d : d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength)); chunk = { cx: f.cx, cy: f.cy, a: f.tiles }; return; }
  const m = JSON.parse(d.toString());
  if (m.t === 'welcome') { id = m.player.id; stats = m.stats; } else if (m.t === 'stats') stats = m.stats;
  else if (m.t === 'freeSpot') spot = m; else if (m.t === 'santa') santa = m;
});
await new Promise((r) => ws.on('open', r));
const send = (m) => ws.send(JSON.stringify(m));
send({ t: 'hello', name: 'Mayor-Santa', v: 'test' }); while (!id) await sleep(20);
while (!santa) await sleep(20);
console.log('on welcome:', JSON.stringify(santa.trees));
if (santa.trees.length) fail('no trees yet, so no stops');
let X = -1, Y = -1;
for (const [cx, cy] of [[144, 30], [160, 36], [120, 44], [200, 40]]) {
  spot = null; send({ t: 'findFree', cx, cy }); while (!spot) await sleep(20); if (spot.cx === null) continue;
  chunk = null; send({ t: 'sub', chunks: [[spot.cx, spot.cy]] }); while (!chunk) await sleep(20);
  for (let y = 2; y < 50 && X < 0; y++) for (let x = 2; x < 40 && X < 0; x++) {
    let ok = true; for (let dy = 0; dy < 6 && ok; dy++) for (let dx = 0; dx < 16; dx++) if (isWater(chunk.a[(y + dy) * 64 + x + dx] & LOMASK)) { ok = false; break; }
    if (ok) { X = spot.cx * 64 + x; Y = spot.cy * 64 + y; }
  }
  if (X >= 0) { send({ t: 'claim', cx: spot.cx, cy: spot.cy }); break; }
}
if (X < 0) fail('no dry site');
await sleep(300); send({ t: 'devFunds', amount: 100000 }); await sleep(200);
for (let k = 0; k < 3; k++) { send({ t: 'devPlace', tool: 'christmastree', x: X + 1 + k * 3, y: Y + 1 }); await sleep(150); }
await sleep(TICK * 3);
const december = stats.inSeason?.includes('christmastree');
console.log('december:', december, '| stops with 3 trees:', santa.trees.length);
if (santa.trees.length) fail('3 trees are not enough for Santa');
send({ t: 'devPlace', tool: 'christmastree', x: X + 10, y: Y + 1 }); await sleep(TICK * 3);
console.log('stops with 4 trees:', JSON.stringify(santa.trees));
if (december) {
  if (santa.trees.length !== 4) fail('4 trees in December: Santa should fly');
  if (!santa.trees.some((t) => t.x === X + 1 && t.y === Y)) fail('a stop is the top of a tree (footprint x+1, top row)');
} else if (santa.trees.length) fail('outside December there is no Santa');
console.log('PASS'); process.exit(0);
