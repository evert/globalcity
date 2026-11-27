// Regression: bulldozing a bridge, an underwater power line or underwater rail must leave water, never land.
import WebSocket from 'ws';
import { decodeChunk } from '@globalcity/shared';
const URL = `ws://127.0.0.1:${process.env.PORT}/ws`;
const CHUNK = 64,
  LOMASK = 0x3ff,
  RIVER = 2;
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
  else if (m.t === 'toast') toasts.push(`${m.kind}: ${m.msg}`);
  else if (m.t === 'tiles' && chunk)
    for (let i = 0; i < m.u.length; i += 3) {
      const x = m.u[i],
        y = m.u[i + 1];
      if (Math.floor(x / CHUNK) === chunk.cx && Math.floor(y / CHUNK) === chunk.cy) chunk.a[(y % CHUNK) * CHUNK + (x % CHUNK)] = m.u[i + 2];
    }
});
const send = (m) => ws.send(JSON.stringify(m));
await new Promise((r) => ws.on('open', r));
send({ t: 'hello', name: 'Dozer' });
while (!me) await sleep(20);
const tile = (x, y) => chunk.a[(y - chunk.cy * CHUNK) * CHUNK + (x - chunk.cx * CHUNK)];
// coastal chunks: try a few until one has a row of three open-water tiles (id RIVER) away from its edges
let row = null;
for (const [cx, cy] of [
  [128, 26],
  [126, 24],
  [140, 24],
  [72, 34],
  [66, 32],
  [228, 50],
]) {
  spot = null;
  send({ t: 'findFree', cx, cy });
  while (!spot) await sleep(20);
  if (spot.cx === null) continue;
  chunk = null;
  send({ t: 'sub', chunks: [[spot.cx, spot.cy]] });
  while (!chunk) await sleep(20);
  for (let y = 4; y < CHUNK - 4 && !row; y++)
    for (let x = 4; x < CHUNK - 6 && !row; x++) {
      let ok = true;
      for (let k = 0; k < 3; k++) if ((chunk.a[y * CHUNK + x + k * 2] & LOMASK) !== RIVER) ok = false;
      if (ok) row = { x: spot.cx * CHUNK + x, y: spot.cy * CHUNK + y };
    }
  if (row) {
    send({ t: 'claim', cx: spot.cx, cy: spot.cy });
    break;
  }
}
if (!row) fail('no claimable chunk with open water found');
await sleep(400);
send({ t: 'devFunds', amount: 10000 });
const cases = [
  ['road', 'bridge', row.x],
  ['wire', 'underwater power line', row.x + 2],
  ['rail', 'underwater rail', row.x + 4],
];
for (const [tool, , x] of cases) {
  send({ t: 'build', tool, x, y: row.y });
  await sleep(60);
}
await sleep(600);
for (const [, what, x] of cases) if ((tile(x, row.y) & LOMASK) === RIVER) fail(`${what} was not built (${toasts.slice(-3).join(' | ')})`);
console.log('built:', cases.map(([, w, x]) => `${w}=${tile(x, row.y) & LOMASK}`).join(', '));
for (const [, , x] of cases) {
  send({ t: 'build', tool: 'bulldozer', x, y: row.y });
  await sleep(60);
}
await sleep(600);
const after = cases.map(([, w, x]) => [w, tile(x, row.y) & LOMASK]);
console.log('after bulldozing:', after.map(([w, id]) => `${w}=${id}`).join(', '));
for (const [w, id] of after) if (id !== RIVER) fail(`bulldozing the ${w} left tile ${id}, expected water (${RIVER})`);
console.log('PASS');
process.exit(0);
