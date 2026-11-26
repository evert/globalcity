// Two mayors with powered airports: both get the airport boost, the server publishes both airports,
// and the shared schedule produces flights between them only.
import WebSocket from 'ws';
import { decodeChunk } from '@globalcity/shared';
const URL = `ws://127.0.0.1:${process.env.PORT}/ws`;
const CHUNK = 64, LOMASK = 0x3ff, isWater = (t) => t >= 2 && t <= 20;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => { console.log('FAIL:', m); process.exit(1); };
class C {
  constructor(name) { this.name = name; this.stats = null; this.chunk = null; this.spot = null; this.airports = null; this.toasts = []; }
  async connect() {
    this.ws = new WebSocket(URL); this.ws.binaryType = 'arraybuffer';
    this.ws.on('message', (d, bin) => {
      if (bin) { const f = decodeChunk(d instanceof ArrayBuffer ? d : d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength)); this.chunk = { cx: f.cx, cy: f.cy, a: f.tiles }; return; }
      const m = JSON.parse(d.toString());
      if (m.t === 'welcome') { this.id = m.player.id; this.stats = m.stats; }
      else if (m.t === 'stats') this.stats = m.stats;
      else if (m.t === 'freeSpot') this.spot = m;
      else if (m.t === 'airports') this.airports = m;
      else if (m.t === 'toast') this.toasts.push(m.kind + ': ' + m.msg);
    });
    await new Promise((r) => this.ws.on('open', r));
    this.send({ t: 'hello', name: this.name });
    while (!this.id) await sleep(20);
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  async build(tool, x, y) { this.send({ t: 'build', tool, x, y }); await sleep(30); }
  async settle(cx, cy) {
    this.spot = null; this.send({ t: 'findFree', cx, cy }); while (!this.spot) await sleep(20);
    this.chunk = null; this.send({ t: 'sub', chunks: [[this.spot.cx, this.spot.cy]] }); this.send({ t: 'claim', cx: this.spot.cx, cy: this.spot.cy });
    while (!this.chunk) await sleep(20);
    this.send({ t: 'devFunds', amount: 100000 });
    this.send({ t: 'devPeak', pop: 1100000 }); // airports unlock at 1,000,000 people
    // dry 12x8 block for coal (4x4) + wire + airport (6x6)
    for (let y = 2; y < 50; y++) for (let x = 2; x < 50; x++) {
      let ok = true; for (let dy = 0; dy < 8 && ok; dy++) for (let dx = 0; dx < 13; dx++) if (isWater(this.chunk.a[(y + dy) * CHUNK + x + dx] & LOMASK)) { ok = false; break; }
      if (!ok) continue;
      const X = this.spot.cx * CHUNK + x, Y = this.spot.cy * CHUNK + y;
      await this.build('coal', X + 1, Y + 1); await this.build('wire', X + 4, Y + 1); await this.build('airport', X + 6, Y + 1);
      return { x: X + 6, y: Y + 1 };
    }
    fail('no dry block for ' + this.name);
  }
}
const A = new C('Pilot-A'), B = new C('Pilot-B');
await A.connect(); await B.connect();
const a = await A.settle(64, 13);
// one airport only: no boost, nothing published as a flight pair
await sleep(Number(process.env.TICK_MS) * 4);
const others = (A.airports?.airports ?? []).filter((p) => p.ownerId !== A.id).length;
console.log('A first: specials.airport =', A.stats.specials.airport, '| other mayors\' airports already in the world =', others);
if (others === 0 && A.stats.specials.airport !== 0) fail('lone airport should not count');
const b = await B.settle(110, 20);
const t0 = Date.now();
while (Date.now() - t0 < 15000 && !(A.airports?.airports.some((p) => p.ownerId === B.id) && A.stats.specials.airport === 1 && B.stats.specials.airport === 1)) await sleep(100);
console.log('both: A specials.airport =', A.stats.specials.airport, '| B =', B.stats.specials.airport, '| airports =', JSON.stringify(A.airports?.airports.map((p) => [p.x, p.y, p.ownerId.slice(0, 4)])));
if (!A.airports?.airports.some((p) => p.ownerId === A.id) || !A.airports.airports.some((p) => p.ownerId === B.id)) fail('expected both airports published');
if (A.stats.specials.airport !== 1 || B.stats.specials.airport !== 1) fail('connected airports should count');
const { activeFlights } = await import('@globalcity/shared');
let n = 0, bad = 0; const seen = new Set();
for (let t = 0; t < 600_000; t += 500) for (const f of activeFlights(A.airports.airports, A.airports.now + t)) {
  if (seen.has(f.key)) continue; seen.add(f.key); n++;
  if (f.fromX === f.toX && f.fromY === f.toY) bad++;
}
console.log(`flights over the next 10 minutes: ${n}, same-airport: ${bad}`);
if (n === 0 || bad) fail('flight schedule');
console.log('PASS'); process.exit(0);
