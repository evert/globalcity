// Zones can be placed over overland power lines; power keeps flowing through the zone.
import WebSocket from 'ws';
const URL = `ws://127.0.0.1:${process.env.PORT}/ws`;
const CHUNK = 64, LOMASK = 0x3ff, ZONEBIT = 0x400, isWater = (t) => t >= 2 && t <= 20;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => { console.log('FAIL:', m); process.exit(1); };
const ws = new WebSocket(URL); ws.binaryType = 'arraybuffer';
let me = null, spot = null, chunk = null, stats = null, query = null; const toasts = [];
ws.on('message', (d, bin) => {
  if (bin) { const dv = new DataView(d instanceof ArrayBuffer ? d : d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength)); const a = new Uint16Array(4096); for (let i = 0; i < 4096; i++) a[i] = dv.getUint16(5 + i * 2, true); chunk = { cx: dv.getUint16(1, true), cy: dv.getUint16(3, true), a }; return; }
  const m = JSON.parse(d.toString());
  if (m.t === 'welcome') me = m.player;
  else if (m.t === 'freeSpot') spot = m;
  else if (m.t === 'stats') stats = m.stats;
  else if (m.t === 'query') query = m.info;
  else if (m.t === 'toast') toasts.push(`${m.kind}: ${m.msg}`);
  else if (m.t === 'tiles' && chunk) for (let i = 0; i < m.u.length; i += 3) { const x = m.u[i], y = m.u[i + 1]; if (Math.floor(x / CHUNK) === chunk.cx && Math.floor(y / CHUNK) === chunk.cy) chunk.a[(y % CHUNK) * CHUNK + (x % CHUNK)] = m.u[i + 2]; }
});
const send = (m) => ws.send(JSON.stringify(m));
const build = async (tool, x, y) => { send({ t: 'build', tool, x, y }); await sleep(30); };
await new Promise((r) => ws.on('open', r));
send({ t: 'hello', name: 'Lineman' });
while (!me) await sleep(20);
spot = null; send({ t: 'findFree', cx: 66, cy: 14 }); while (!spot) await sleep(20);
chunk = null; send({ t: 'sub', chunks: [[spot.cx, spot.cy]] }); while (!chunk) await sleep(20);
send({ t: 'claim', cx: spot.cx, cy: spot.cy });
let X = -1, Y = -1;
for (let y = 4; y < 50 && X < 0; y++) for (let x = 2; x < 30 && X < 0; x++) {
  let ok = true; for (let dy = 0; dy < 8 && ok; dy++) for (let dx = 0; dx < 30; dx++) if (isWater(chunk.a[(y + dy) * CHUNK + x + dx] & LOMASK)) { ok = false; break; }
  if (ok) { X = spot.cx * CHUNK + x; Y = spot.cy * CHUNK + y; }
}
if (X < 0) fail('no dry area');
await sleep(300);
send({ t: 'devFunds', amount: 20000 });
await sleep(300);
const tile = (x, y) => chunk.a[(y - chunk.cy * CHUNK) * CHUNK + (x - chunk.cx * CHUNK)];
// coal plant occupies X..X+3, Y..Y+3 (hot-spot X+1,Y+1); line along row Y+1 from X+4 to X+24
await build('coal', X + 1, Y + 1);
for (let x = X + 4; x <= X + 24; x++) await build('wire', x, Y + 1);
await sleep(500);
const funds0 = stats.funds;
// trees/rubble in the two footprints are auto-bulldozed at $1 each on top of the line tiles
let clearing = 0;
for (const cx of [X + 12, X + 26]) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
  const id = tile(cx + dx, Y + 1 + dy) & LOMASK; if ((id >= 21 && id <= 39) || (id >= 44 && id <= 47)) clearing++;
}
// residential zone centred on the line at X+12 (footprint X+11..X+13, rows Y..Y+2): crosses 3 wire tiles
await build('residential', X + 12, Y + 1);
// far zone just past the end of the line (footprint X+25..X+27)
await build('residential', X + 26, Y + 1);
await sleep(600);
const mid = tile(X + 12, Y + 1);
if (!(tile(X + 26, Y + 1) & ZONEBIT)) fail(`far zone was not placed (${toasts.slice(-2).join(' | ')})`);
if (!(mid & ZONEBIT)) fail(`zone over the power line was not placed (${toasts.slice(-2).join(' | ')})`);
const expected = 2 * 100 + 3 + clearing;
console.log(`zone over line placed; cost ${funds0 - stats.funds} (expected ${expected}: 2 zones, 3 line tiles, ${clearing} trees/rubble)`);
// (monthly upkeep can land during the wait, so the cost is only checked as a lower bound)
if (funds0 - stats.funds < expected) fail('placement cost too low');
// the far zone is only connected through the first zone; it must be powered after a couple of ticks
const T = Number(process.env.TICK_MS) || 2000;
let powered = false;
for (let k = 0; k < 6 && !powered; k++) { await sleep(T); query = null; send({ t: 'query', x: X + 26, y: Y + 1 }); while (!query) await sleep(20); powered = query.powered; }
console.log('far zone powered through the first zone:', powered);
if (!powered) fail('power did not flow through the zone');
// the line piece just west of the zone is now a line end (re-tabled), not a through-piece into nothing
console.log('line tile next to the zone:', tile(X + 10, Y + 1) & LOMASK);
console.log('PASS'); process.exit(0);
