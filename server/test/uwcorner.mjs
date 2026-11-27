// Underwater power lines turn corners: an L-shaped run gets a corner piece, the straights keep their axis,
// and bulldozing the corner leaves water. Needs DEV_HOOKS=1.
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
send({ t: 'hello', name: 'Cable layer' });
while (!me) await sleep(20);
const tile = (x, y) => chunk.a[(y - chunk.cy * CHUNK) * CHUNK + (x - chunk.cx * CHUNK)];
// coastal chunks: find a 4x4 block of open water (id RIVER) away from the chunk edges
let at = null;
const open = (x, y) => (chunk.a[y * CHUNK + x] & LOMASK) === RIVER;
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
  for (let y = 4; y < CHUNK - 8 && !at; y++)
    for (let x = 4; x < CHUNK - 8 && !at; x++) {
      let ok = true;
      for (let dy = -1; dy < 4; dy++) for (let dx = -1; dx < 4; dx++) if (!open(x + dx, y + dy)) ok = false;
      if (ok) at = { x: spot.cx * CHUNK + x, y: spot.cy * CHUNK + y };
    }
  if (at) {
    send({ t: 'claim', cx: spot.cx, cy: spot.cy });
    break;
  }
}
if (!at) fail('no claimable chunk with open water found');
await sleep(400);
send({ t: 'devFunds', amount: 10000 });
const NS = 208,
  EW = 209,
  NE = 1019,
  SE = 1020,
  SW = 1021,
  NW = 1022;
const id = (x, y) => tile(at.x + x, at.y + y) & LOMASK;
const expect = (want, what) => {
  for (const [x, y, t] of want) if (id(x, y) !== t) fail(`${what}: tile ${x},${y} is ${id(x, y)}, expected ${t} (${toasts.slice(-3).join(' | ')})`);
};
// east along the top row, then south down the right column: ─ ─ ┐ │ │
for (const [x, y] of [
  [0, 0],
  [1, 0],
  [2, 0],
  [2, 1],
  [2, 2],
]) {
  send({ t: 'build', tool: 'wire', x: at.x + x, y: at.y + y });
  await sleep(60);
}
await sleep(600);
expect(
  [
    [0, 0, EW],
    [1, 0, EW],
    [2, 0, SW],
    [2, 1, NS],
    [2, 2, NS],
  ],
  'L-shaped run',
);
// close a square: west along the bottom, north up the left column
for (const [x, y] of [
  [1, 2],
  [0, 2],
  [0, 1],
]) {
  send({ t: 'build', tool: 'wire', x: at.x + x, y: at.y + y });
  await sleep(60);
}
await sleep(600);
expect(
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
console.log(
  'square of underwater cable OK:',
  [
    [0, 0],
    [1, 0],
    [2, 0],
    [0, 1],
    [2, 1],
    [0, 2],
    [1, 2],
    [2, 2],
  ]
    .map(([x, y]) => id(x, y))
    .join(' '),
);
// the corners conduct: a coal plant is not needed, only that the pieces count as wires (isWire), so bulldoze one
send({ t: 'build', tool: 'bulldozer', x: at.x + 2, y: at.y });
await sleep(600);
if (id(2, 0) !== RIVER) fail(`bulldozing a corner left tile ${id(2, 0)}, expected water`);
expect(
  [
    [1, 0, EW],
    [2, 1, NS],
  ],
  'neighbours after removing a corner',
);
console.log('PASS');
process.exit(0);
