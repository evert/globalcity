// Grand Central: locked until the city's rail reaches another mayor's city; placed over an east-west line
// (clicking the rail tile), its bottom row is real rail joined to the line on both sides; one per city; the
// track can't be bulldozed or built over on its own; bulldozing the station leaves the track. Needs DEV_HOOKS=1.
import WebSocket from 'ws';
import { decodeChunk } from '@globalcity/shared';
const PORT = process.env.PORT, TICK = Number(process.env.TICK_MS) || 500;
const CHUNK = 64, LOMASK = 0x3ff, ZONEBIT = 0x400, isWater = (t) => t >= 2 && t <= 20, CUSTOMFILL = 1017, CUSTOMCENTRE = 1018;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => { console.log('FAIL:', m); process.exit(1); };
class C {
  constructor(name) { this.name = name; this.toasts = []; this.stats = null; this.chunk = null; this.spot = null; this.buildings = null; this.events = []; this.query = null; }
  async connect() {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`); this.ws.binaryType = 'arraybuffer';
    this.ws.on('message', (d, bin) => {
      if (bin) { const f = decodeChunk(d instanceof ArrayBuffer ? d : d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength)); this.chunk = { cx: f.cx, cy: f.cy, a: f.tiles }; return; }
      const m = JSON.parse(d.toString());
      if (m.t === 'welcome') { this.id = m.player.id; this.stats = m.stats; }
      else if (m.t === 'stats') this.stats = m.stats; else if (m.t === 'freeSpot') this.spot = m;
      else if (m.t === 'toast') this.toasts.push(`${m.kind}: ${m.msg}`);
      else if (m.t === 'buildings') this.buildings = m.list; else if (m.t === 'building') this.events.push(`${m.op} ${m.b.kind} ${m.b.x},${m.b.y}`);
      else if (m.t === 'query') this.query = m.info;
      else if (m.t === 'tiles' && this.chunk) for (let i = 0; i < m.u.length; i += 3) { const x = m.u[i], y = m.u[i + 1]; if (Math.floor(x / CHUNK) === this.chunk.cx && Math.floor(y / CHUNK) === this.chunk.cy) this.chunk.a[(y % CHUNK) * CHUNK + (x % CHUNK)] = m.u[i + 2]; }
    });
    await new Promise((r) => this.ws.on('open', r));
    this.send({ t: 'hello', name: this.name, v: 'test' }); while (!this.id) await sleep(20);
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  tile(x, y) { return this.chunk.a[(y - this.chunk.cy * CHUNK) * CHUNK + (x - this.chunk.cx * CHUNK)]; }
  async build(tool, x, y) { const n = this.toasts.length; this.send({ t: 'build', tool, x, y }); await sleep(300); return this.toasts.slice(n); }
}
const A = new C('Stationmaster');
await A.connect();
let X = -1, Y = -1;
for (const [cx, cy] of [[144, 30], [160, 36], [120, 44], [200, 40]]) {
  A.spot = null; A.send({ t: 'findFree', cx, cy }); while (!A.spot) await sleep(20); if (A.spot.cx === null) continue;
  A.chunk = null; A.send({ t: 'sub', chunks: [[A.spot.cx, A.spot.cy]] }); while (!A.chunk) await sleep(20);
  for (let y = 2; y < 50 && X < 0; y++) for (let x = 2; x < 44 && X < 0; x++) {
    let ok = true; for (let dy = 0; dy < 12 && ok; dy++) for (let dx = 0; dx < 18; dx++) if (isWater(A.chunk.a[(y + dy) * 64 + x + dx] & LOMASK)) { ok = false; break; }
    if (ok) { X = A.spot.cx * 64 + x; Y = A.spot.cy * 64 + y; }
  }
  if (X >= 0) { A.send({ t: 'claim', cx: A.spot.cx, cy: A.spot.cy }); break; }
}
if (X < 0) fail('no dry site');
await sleep(300); A.send({ t: 'devFunds', amount: 100000 }); await sleep(200);
const LHRAIL = 226, RAIL = (v) => { const t = v & LOMASK; return t >= 224 && t <= 238; };
const R = Y + 2; // the line
for (let x = X; x < X + 12; x++) await A.build('rail', x, R);
await sleep(300);
let t = await A.build('grandcentral', X + 3, R);
console.log('before a rail link:', t.join(' | '));
if (!t.some((x) => /unlocks when you connect your rail network/.test(x))) fail('Grand Central should be locked');
A.send({ t: 'devRailLink' }); await sleep(300);
if (!A.stats.unlocked.includes('grandcentral')) fail('unlocked list should include grandcentral');
// clicking the rail tile at (X+3, R): footprint x X+1..X+6, rows R-2..R
t = await A.build('grandcentral', X + 3, R); await sleep(300);
console.log('placed:', t.join(' | ') || 'ok', '| events', A.events.join(', '));
if (!A.events.includes(`add grandcentral ${X + 1},${R - 2}`)) fail('station not added at the expected anchor: ' + A.events.join(', '));
for (let dx = 0; dx < 6; dx++) {
  if (!RAIL(A.tile(X + 1 + dx, R))) fail(`station row tile ${dx} is not rail: ${A.tile(X + 1 + dx, R) & LOMASK}`);
  for (const dy of [1, 2]) { const id = A.tile(X + 1 + dx, R - dy) & LOMASK; if (id !== CUSTOMFILL && id !== CUSTOMCENTRE) fail(`hall tile ${dx},${dy} is ${id}`); }
}
if (!RAIL(A.tile(X, R)) || !RAIL(A.tile(X + 7, R))) fail('the line outside the station should still be rail');
t = await A.build('grandcentral', X + 3, R + 8);
if (!t.some((x) => /already has a Grand Central/.test(x))) fail('second station should be refused: ' + t.join(' | '));
t = await A.build('bulldozer', X + 3, R);
if (!t.some((x) => /track runs through Grand Central/.test(x)) || !RAIL(A.tile(X + 3, R))) fail('station track should resist the bulldozer: ' + t.join(' | '));
t = await A.build('road', X + 3, R);
if (!t.some((x) => /part of the grand central/.test(x))) fail('road over the station track should be refused: ' + t.join(' | '));
// tick a little: upkeep and stats run with the station
await sleep(TICK * 3);
if ((A.stats.built?.grandcentral ?? 0) !== 1) fail(`built.grandcentral should be 1, got ${A.stats.built?.grandcentral}`);
t = await A.build('bulldozer', X + 2, R - 2); await sleep(300);
console.log('bulldozed:', t.join(' | ') || 'ok', '| events', A.events.join(', '));
if (!A.events.includes(`remove grandcentral ${X + 1},${R - 2}`)) fail('station not removed');
for (let dx = 0; dx < 6; dx++) if (!RAIL(A.tile(X + 1 + dx, R))) fail('track should stay after bulldozing the station');
// built again on bare land (no rail yet): the station lays its own track
t = await A.build('grandcentral', X + 3, R + 6); await sleep(300);
if (!A.events.includes(`add grandcentral ${X + 1},${R + 4}`)) fail('station on bare land not placed: ' + t.join(' | '));
for (let dx = 0; dx < 6; dx++) if ((A.tile(X + 1 + dx, R + 6) & LOMASK) !== LHRAIL) fail('station on bare land should lay rail');
console.log('PASS'); process.exit(0);
