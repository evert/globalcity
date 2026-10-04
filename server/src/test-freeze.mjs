// A city whose mayor goes quiet freezes (no growth/decline, no budget); a neighbour keeps drawing power
// from its plant; the city resumes when the mayor is back. Run the server with CITY_FREEZE_MS=4000.
import WebSocket from 'ws';
const PORT = process.env.PORT, TICK = Number(process.env.TICK_MS) || 500, FREEZE = Number(process.env.CITY_FREEZE_MS) || 4000;
const CHUNK = 64, LOMASK = 0x3ff, isWater = (t) => t >= 2 && t <= 20;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => { console.log('FAIL:', m); process.exit(1); };
class C {
  constructor(name) { this.name = name; this.stats = null; this.statsMsgs = 0; this.chunk = null; this.spot = null; }
  async connect() {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`); this.ws.binaryType = 'arraybuffer';
    this.ws.on('message', (d, bin) => {
      if (bin) { const dv = new DataView(d instanceof ArrayBuffer ? d : d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength)); const a = new Uint16Array(4096); for (let i = 0; i < 4096; i++) a[i] = dv.getUint16(5 + i * 2, true); this.chunk = { cx: dv.getUint16(1, true), cy: dv.getUint16(3, true), a }; return; }
      const m = JSON.parse(d.toString());
      if (m.t === 'welcome') { this.id = m.player.id; this.stats = m.stats; }
      else if (m.t === 'stats') { this.stats = m.stats; this.statsMsgs++; }
      else if (m.t === 'freeSpot') this.spot = m;
    });
    await new Promise((r) => this.ws.on('open', r));
    this.send({ t: 'hello', name: this.name }); while (!this.id) await sleep(20);
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  async build(tool, x, y) { this.send({ t: 'build', tool, x, y }); await sleep(30); }
}
const A = new C('Away-A'), B = new C('Neighbour-B');
await A.connect(); await B.connect();
// two adjacent free chunks with a dry band across the border
let site = null;
for (const [cx, cy] of [[66, 14], [70, 15], [40, 12], [60, 20], [110, 22]]) {
  A.spot = null; A.send({ t: 'findFree', cx, cy }); while (!A.spot) await sleep(20); if (A.spot.cx === null) continue;
  const a = A.spot; B.spot = null; B.send({ t: 'findFree', cx: a.cx + 1, cy: a.cy }); while (!B.spot) await sleep(20);
  if (B.spot.cx !== a.cx + 1 || B.spot.cy !== a.cy) continue;
  A.chunk = null; A.send({ t: 'sub', chunks: [[a.cx, a.cy]] }); while (!A.chunk) await sleep(20); const ca = A.chunk.a;
  B.chunk = null; B.send({ t: 'sub', chunks: [[a.cx + 1, a.cy]] }); while (!B.chunk) await sleep(20); const cb = B.chunk.a;
  for (let y = 4; y < 50 && !site; y++) {
    let ok = true;
    for (let dy = 0; dy < 10 && ok; dy++) { for (let x = 40; x < 64; x++) if (isWater(ca[(y + dy) * 64 + x] & LOMASK)) ok = false; for (let x = 0; x < 16; x++) if (isWater(cb[(y + dy) * 64 + x] & LOMASK)) ok = false; }
    if (ok) site = { cx: a.cx, cy: a.cy, Y: a.cy * 64 + y };
  }
  if (site) break;
}
if (!site) fail('no adjacent dry site');
const { cx, cy, Y } = site, AX = (cx + 1) * CHUNK - 24, BX = (cx + 1) * CHUNK;
A.send({ t: 'claim', cx, cy }); B.send({ t: 'claim', cx: cx + 1, cy }); await sleep(400);
A.send({ t: 'devFunds', amount: 50000 }); B.send({ t: 'devFunds', amount: 50000 }); await sleep(300);
await A.build('coal', AX + 1, Y + 1);
for (let x = AX + 4; x < BX; x++) await A.build('wire', x, Y + 1);
for (let i = 0; i < 4; i++) await A.build('residential', AX + 5 + i * 4, Y + 4);
for (let x = AX; x < BX; x++) await A.build('road', x, Y + 6);
for (let x = BX; x < BX + 3; x++) await B.build('wire', x, Y + 1);
await B.build('residential', BX + 4, Y + 1); await B.build('residential', BX + 8, Y + 1);
for (let x = BX; x < BX + 12; x++) await B.build('road', x, Y + 3);
// let A grow while A keeps "playing" (pings)
const t0 = Date.now();
while (Date.now() - t0 < 60 * TICK && !((A.stats?.population ?? 0) > 0 && (B.stats?.powerImported ?? 0) > 0)) { A.send({ t: 'ping' }); B.send({ t: 'ping' }); await sleep(TICK); }
if (!((A.stats?.population ?? 0) > 0)) fail('A never grew');
if (!((B.stats?.powerImported ?? 0) > 0)) fail('B never imported power from A');
console.log(`running: A pop ${A.stats.population} funds ${A.stats.funds}; B imports ${B.stats.powerImported}`);
// A goes quiet; B keeps pinging
const quietAt = Date.now();
while (Date.now() - quietAt < FREEZE + 2 * TICK) { B.send({ t: 'ping' }); await sleep(TICK); }
const frozenStats = JSON.stringify(A.stats), msgs = A.statsMsgs;
for (let k = 0; k < 8; k++) { B.send({ t: 'ping' }); await sleep(TICK); }
console.log(`frozen for 8 ticks: A stats messages ${A.statsMsgs - msgs}, stats unchanged ${JSON.stringify(A.stats) === frozenStats}; B imports ${B.stats.powerImported}, B pop ${B.stats.population}`);
if (A.statsMsgs !== msgs || JSON.stringify(A.stats) !== frozenStats) {
  const a = JSON.parse(frozenStats), b = A.stats;
  fail('frozen city changed: ' + Object.keys(b).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).map((k) => `${k} ${JSON.stringify(a[k])} -> ${JSON.stringify(b[k])}`).join('; '));
}
if (!((B.stats.powerImported ?? 0) > 0)) fail('neighbour lost power when A froze');
// A comes back
const before = A.stats.funds; const m0 = A.statsMsgs;
for (let k = 0; k < 10 && A.statsMsgs === m0; k++) { A.send({ t: 'ping' }); B.send({ t: 'ping' }); await sleep(TICK); }
console.log(`after return: A stats messages ${A.statsMsgs - m0}, funds ${before} -> ${A.stats.funds}`);
if (A.statsMsgs === m0) fail('city did not resume');
console.log('PASS'); process.exit(0);
