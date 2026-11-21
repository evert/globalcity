// Nature returns: rubble turns back into the landscape that was there before anyone built, but not while the
// city's mayor is playing. Run the server on a throwaway save dir with a fast regrowth and freeze:
//   PORT=8791 DATA_DIR=<tmp> DEV_HOOKS=1 TICK_MS=500 REGROW_MS=1000 REGROW_P=0.5 CITY_FREEZE_MS=3000 npx tsx src/index.ts
//   PORT=8791 npx tsx src/test-regrow.mjs
import WebSocket from 'ws';
const PORT = process.env.PORT;
const LOMASK = 0x3ff, isWater = (t) => t >= 2 && t <= 20, isRubble = (t) => t >= 44 && t <= 47;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => { console.log('FAIL:', m); process.exit(1); };

/** A connected player: hello, then the latest snapshot of the chunk it subscribed to. */
async function connect(name) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`); ws.binaryType = 'arraybuffer';
  const c = { ws, me: null, spot: null, chunk: null, toasts: [] };
  ws.on('message', (d, bin) => {
    if (bin) { const dv = new DataView(d instanceof ArrayBuffer ? d : d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength)); const a = new Uint16Array(4096); for (let i = 0; i < 4096; i++) a[i] = dv.getUint16(5 + i * 2, true); c.chunk = { cx: dv.getUint16(1, true), cy: dv.getUint16(3, true), a }; return; }
    const m = JSON.parse(d.toString());
    if (m.t === 'welcome') c.me = m.player; else if (m.t === 'freeSpot') c.spot = m; else if (m.t === 'toast') c.toasts.push(`${m.kind}: ${m.msg}`);
  });
  c.send = (m) => ws.send(JSON.stringify(m));
  await new Promise((r) => ws.on('open', r)); c.send({ t: 'hello', name, v: 'test' }); while (!c.me) await sleep(20);
  return c;
}
/** The chunk's tiles as a fresh subscriber sees them now. */
async function snapshot(cx, cy) {
  const o = await connect('Observer');
  o.send({ t: 'sub', chunks: [[cx, cy]] }); while (!o.chunk) await sleep(20);
  o.ws.close();
  return o.chunk.a;
}

const A = await connect('Gardener');
A.send({ t: 'findFree', cx: 70, cy: 18 }); while (!A.spot) await sleep(20);
const { cx, cy } = A.spot;
A.send({ t: 'sub', chunks: [[cx, cy]] }); while (!A.chunk) await sleep(20);
const orig = A.chunk.a.slice();
// a dry 9x6 site for six residential zones
let sx = -1, sy = -1;
for (let y = 4; y < 50 && sx < 0; y++) for (let x = 4; x < 50 && sx < 0; x++) {
  let ok = true; for (let dy = 0; dy < 6 && ok; dy++) for (let dx = 0; dx < 9; dx++) if (isWater(orig[(y + dy) * 64 + x + dx] & LOMASK)) { ok = false; break; }
  if (ok) { sx = x; sy = y; }
}
if (sx < 0) fail('no dry site');
A.send({ t: 'claim', cx, cy }); await sleep(400);
const X = cx * 64 + sx, Y = cy * 64 + sy;
for (let j = 0; j < 2; j++) for (let i = 0; i < 3; i++) { A.send({ t: 'build', tool: 'residential', x: X + 1 + i * 3, y: Y + 1 + j * 3 }); await sleep(40); }
await sleep(300);
for (let j = 0; j < 2; j++) for (let i = 0; i < 3; i++) { A.send({ t: 'build', tool: 'bulldozer', x: X + 1 + i * 3, y: Y + 1 + j * 3 }); await sleep(40); }
await sleep(300);
const site = []; for (let dy = 0; dy < 6; dy++) for (let dx = 0; dx < 9; dx++) site.push((sy + dy) * 64 + sx + dx);
const rubbleIn = (a) => site.filter((k) => isRubble(a[k] & LOMASK)).length;
const restoredIn = (a) => site.filter((k) => a[k] === orig[k]).length;
let now = await snapshot(cx, cy);
console.log(`bulldozed: ${rubbleIn(now)}/${site.length} rubble`);
if (rubbleIn(now) !== site.length) fail('the bulldozed zones should be all rubble');

// the mayor keeps playing: several regrowth passes, the rubble stays
for (let i = 0; i < 8; i++) { A.send({ t: 'ping' }); await sleep(500); }
now = await snapshot(cx, cy);
console.log(`mayor online for 4 s of regrowth: ${rubbleIn(now)} rubble left`);
if (rubbleIn(now) !== site.length) fail('rubble regrew in a city whose mayor is playing');

// the mayor leaves: once the city is frozen the land grows back to exactly what was there
A.ws.close();
await sleep(3000 + 8000);
now = await snapshot(cx, cy);
console.log(`mayor away: ${rubbleIn(now)} rubble left, ${restoredIn(now)}/${site.length} tiles back to the original landscape`);
if (rubbleIn(now) > 2) fail('rubble should have grown back');
if (restoredIn(now) + rubbleIn(now) !== site.length) fail('regrown tiles should match the original landscape');
console.log('PASS');
process.exit(0);
