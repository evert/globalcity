// Christmas tree: a 2x4 custom building on the milestone ladder (20,000 people, right after the fire station) that
// can only be built in December. The runner starts this test twice: with SEASON_MONTH=12 (it must place) and as
// christmastree_off with SEASON_MONTH=11 (it must be refused, though unlocked). Needs DEV_HOOKS=1.
import WebSocket from 'ws';
import { decodeChunk } from '@globalcity/shared';
const PORT = process.env.PORT, TICK = Number(process.env.TICK_MS) || 500;
const CHUNK = 64, LOMASK = 0x3ff, ZONEBIT = 0x400, isWater = (t) => t >= 2 && t <= 20, CUSTOMFILL = 1017, CUSTOMCENTRE = 1018;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => { console.log('FAIL:', m); process.exit(1); };
class C {
  constructor(name) { this.name = name; this.toasts = []; this.stats = null; this.chunk = null; this.spot = null; this.events = []; }
  async connect() {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`); this.ws.binaryType = 'arraybuffer';
    this.ws.on('message', (d, bin) => {
      if (bin) { const f = decodeChunk(d instanceof ArrayBuffer ? d : d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength)); this.chunk = { cx: f.cx, cy: f.cy, a: f.tiles }; return; }
      const m = JSON.parse(d.toString());
      if (m.t === 'welcome') { this.id = m.player.id; this.stats = m.stats; }
      else if (m.t === 'stats') this.stats = m.stats; else if (m.t === 'freeSpot') this.spot = m;
      else if (m.t === 'toast') this.toasts.push(`${m.kind}: ${m.msg}`);
      else if (m.t === 'building') this.events.push(`${m.op} ${m.b.kind} ${m.b.x},${m.b.y}`);
      else if (m.t === 'tiles' && this.chunk) for (let i = 0; i < m.u.length; i += 3) { const x = m.u[i], y = m.u[i + 1]; if (Math.floor(x / CHUNK) === this.chunk.cx && Math.floor(y / CHUNK) === this.chunk.cy) this.chunk.a[(y % CHUNK) * CHUNK + (x % CHUNK)] = m.u[i + 2]; }
    });
    await new Promise((r) => this.ws.on('open', r));
    this.send({ t: 'hello', name: this.name, v: 'test' }); while (!this.id) await sleep(20);
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  tile(x, y) { return this.chunk.a[(y - this.chunk.cy * CHUNK) * CHUNK + (x - this.chunk.cx * CHUNK)]; }
  async build(tool, x, y) { const n = this.toasts.length; this.send({ t: 'build', tool, x, y }); await sleep(300); return this.toasts.slice(n); }
}
const A = new C('Mayor-Xmas'); await A.connect();
let X = -1, Y = -1;
for (const [cx, cy] of [[144, 30], [160, 36], [120, 44], [200, 40]]) {
  A.spot = null; A.send({ t: 'findFree', cx, cy }); while (!A.spot) await sleep(20); if (A.spot.cx === null) continue;
  A.chunk = null; A.send({ t: 'sub', chunks: [[A.spot.cx, A.spot.cy]] }); while (!A.chunk) await sleep(20);
  for (let y = 2; y < 50 && X < 0; y++) for (let x = 2; x < 50 && X < 0; x++) {
    let ok = true; for (let dy = 0; dy < 8 && ok; dy++) for (let dx = 0; dx < 12; dx++) if (isWater(A.chunk.a[(y + dy) * 64 + x + dx] & LOMASK)) { ok = false; break; }
    if (ok) { X = A.spot.cx * 64 + x; Y = A.spot.cy * 64 + y; }
  }
  if (X >= 0) { A.send({ t: 'claim', cx: A.spot.cx, cy: A.spot.cy }); break; }
}
if (X < 0) fail('no dry site');
await sleep(300); A.send({ t: 'devFunds', amount: 100000 }); await sleep(200);
await A.build('residential', X + 8, Y + 2); // a zone, so the city is simulated and milestones get announced
await sleep(TICK * 3); // inSeason comes with the stats of the next tick
const december = A.stats.inSeason?.includes('christmastree');
console.log('in season:', december, '| inSeason', JSON.stringify(A.stats.inSeason));

// locked below 20,000; fire comes first, the tree is the next milestone after it
let t = await A.build('christmastree', X + 1, Y + 1);
console.log('at 0 people:', t.join(' | '));
if (!t.some((x) => /Christmas tree unlocks at 20,000 people/.test(x))) fail('tree should be locked below 20,000');
A.send({ t: 'devPeak', pop: 16000 }); await sleep(TICK * 3);
console.log('at 16,000: unlocked', JSON.stringify(A.stats.unlocked), '| next milestone', A.stats.nextMilestone);
if (!A.stats.unlocked.includes('fire') || A.stats.unlocked.includes('christmastree')) fail('16,000 unlocks the fire station only');
if (A.stats.nextMilestone !== 20000) fail('the next milestone after the fire station should be the tree at 20,000');
A.send({ t: 'devPeak', pop: 21000 }); await sleep(TICK * 3);
const toast = A.toasts.find((x) => /Milestone: 20,000/.test(x));
console.log('at 21,000: unlocked', JSON.stringify(A.stats.unlocked), '| toast:', toast);
if (!A.stats.unlocked.includes('christmastree') || A.stats.unlocked.includes('police')) fail('21,000 unlocks the tree, not police');
if (!toast || !/a Christmas tree in December/.test(toast)) fail('milestone toast');

t = await A.build('christmastree', X + 1, Y + 1);
console.log('build:', t.join(' | ') || 'placed');
if (!december) {
  if (!t.some((x) => /can only be built in December/.test(x))) fail('out of season the tree must be refused');
  if ((A.tile(X + 1, Y + 1) & LOMASK) === CUSTOMCENTRE) fail('a tree was placed out of season');
  console.log('PASS'); process.exit(0);
}
let fill = 0, centre = 0; for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 2; dx++) { const v = A.tile(X + dx, Y + dy), id = v & LOMASK; if (id === CUSTOMFILL) fill++; if (id === CUSTOMCENTRE && (v & ZONEBIT)) centre++; }
console.log(`footprint: ${fill} fill + ${centre} centre | events ${A.events.join(', ')}`);
if (fill !== 7 || centre !== 1) fail('2x4 footprint not laid out');
if (!A.events.includes(`add christmastree ${X},${Y}`)) fail('the building layer should report the tree');
t = await A.build('christmastree', X + 4, Y + 1); // no per-city limit
if ((A.tile(X + 4, Y + 1) & LOMASK) !== CUSTOMCENTRE) fail('a second tree should be allowed: ' + t.join(' | '));
await sleep(TICK * 3);
console.log('built:', A.stats.built.christmastree);
if (A.stats.built.christmastree !== 2) fail('built count');
console.log('PASS'); process.exit(0);
