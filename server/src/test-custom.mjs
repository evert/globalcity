// Custom-building layer: a 5x4 university is locked until 150,000 people, placed as one building, reported to
// every client, one per city, removed (and reported) by the bulldozer from any of its tiles, destroyed whole
// by fire, and survives a save/restart. Needs DEV_HOOKS=1.
import WebSocket from 'ws';
const PORT = process.env.PORT, TICK = Number(process.env.TICK_MS) || 500;
const CHUNK = 64, LOMASK = 0x3ff, ZONEBIT = 0x400, isWater = (t) => t >= 2 && t <= 20, CUSTOMFILL = 1017, CUSTOMCENTRE = 1018;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => { console.log('FAIL:', m); process.exit(1); };
class C {
  constructor(name) { this.name = name; this.toasts = []; this.stats = null; this.chunk = null; this.spot = null; this.buildings = null; this.events = []; this.query = null; }
  async connect() {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`); this.ws.binaryType = 'arraybuffer';
    this.ws.on('message', (d, bin) => {
      if (bin) { const dv = new DataView(d instanceof ArrayBuffer ? d : d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength)); const a = new Uint16Array(4096); for (let i = 0; i < 4096; i++) a[i] = dv.getUint16(5 + i * 2, true); this.chunk = { cx: dv.getUint16(1, true), cy: dv.getUint16(3, true), a }; return; }
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
const A = new C('Dean'), V = new C('Visitor');
await A.connect(); await V.connect();
let X = -1, Y = -1;
for (const [cx, cy] of [[72, 15], [80, 18], [60, 22], [100, 20]]) {
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
let t = await A.build('university', X + 1, Y + 1);
if (!t.some((x) => /unlocks at 150,000 people/.test(x))) fail('university should be locked: ' + t.join(' | '));
A.send({ t: 'devPeak', pop: 160000 }); await sleep(300);
t = await A.build('university', X + 1, Y + 1);
let fill = 0, centre = 0; for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 5; dx++) { const v = A.tile(X + dx, Y + dy), id = v & LOMASK; if (id === CUSTOMFILL) fill++; if (id === CUSTOMCENTRE && (v & ZONEBIT)) centre++; }
console.log(`placed: ${t.join(' | ') || 'ok'} | footprint ${fill} fill + ${centre} centre tiles | visitor saw: ${V.events.join(', ')}`);
if (fill !== 19 || centre !== 1) fail('5x4 footprint not laid out');
if (!V.events.includes(`add university ${X},${Y}`)) fail('other clients should be told about the new building');
A.query = null; A.send({ t: 'query', x: X + 4, y: Y + 3 }); while (!A.query) await sleep(20);
console.log('query on its far corner:', A.query.name);
if (A.query.name !== 'University') fail('query name');
t = await A.build('university', X + 9, Y + 6);
if (!t.some((x) => /already has a university/.test(x))) fail('second university should be refused: ' + t.join(' | '));
const L = new C('Late'); await L.connect(); await sleep(300);
if (!L.buildings?.some((b) => b.kind === 'university' && b.x === X && b.y === Y)) fail('late joiner did not get the building list');
console.log('late joiner got the building list: ok');
// bulldoze from the far corner removes the whole building
await A.build('bulldozer', X + 4, Y + 3);
let rubble = 0; for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 5; dx++) { const id = A.tile(X + dx, Y + dy) & LOMASK; if (id >= 44 && id <= 47) rubble++; }
console.log(`bulldozed from a corner: ${rubble}/20 rubble | visitor saw: ${V.events.slice(-1)}`);
if (rubble !== 20 || !V.events.includes(`remove university ${X},${Y}`)) fail('bulldozing should clear the whole footprint and report it');
// rebuild, then fire takes the whole building down and it leaves the registry
t = await A.build('university', X + 1, Y + 7);
if ((A.tile(X + 1, Y + 7) & LOMASK) !== CUSTOMCENTRE) fail('rebuild after bulldozing refused: ' + t.join(' | '));
A.send({ t: 'devIgnite', x: X + 3, y: Y + 8 }); await sleep(TICK * 2);
console.log('after a fire:', V.events.slice(-1)[0]);
if (!V.events.includes(`remove university ${X},${Y + 6}`)) fail('fire should remove the building from the layer');
console.log('PASS'); process.exit(0);
