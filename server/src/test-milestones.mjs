// Milestones: locked until the population threshold, one per city, rebuildable, grandfathered extras;
// plus rail counting as transport access for zone growth. Needs DEV_HOOKS=1.
import WebSocket from 'ws';
const PORT = process.env.PORT, TICK = Number(process.env.TICK_MS) || 500;
const CHUNK = 64, LOMASK = 0x3ff, ZONEBIT = 0x400, isWater = (t) => t >= 2 && t <= 20;
const CITYHALL = 965, AIRPORT = 716;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => { console.log('FAIL:', m); process.exit(1); };
class C {
  constructor(name) { this.name = name; this.toasts = []; this.stats = null; this.chunk = null; this.spot = null; }
  async connect() {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`); this.ws.binaryType = 'arraybuffer';
    this.ws.on('message', (d, bin) => {
      if (bin) { const dv = new DataView(d instanceof ArrayBuffer ? d : d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength)); const a = new Uint16Array(4096); for (let i = 0; i < 4096; i++) a[i] = dv.getUint16(5 + i * 2, true); this.chunk = { cx: dv.getUint16(1, true), cy: dv.getUint16(3, true), a }; return; }
      const m = JSON.parse(d.toString());
      if (m.t === 'welcome') { this.id = m.player.id; this.stats = m.stats; }
      else if (m.t === 'stats') this.stats = m.stats;
      else if (m.t === 'freeSpot') this.spot = m;
      else if (m.t === 'toast') this.toasts.push(`${m.kind}: ${m.msg}`);
      else if (m.t === 'tiles' && this.chunk) for (let i = 0; i < m.u.length; i += 3) { const x = m.u[i], y = m.u[i + 1]; if (Math.floor(x / CHUNK) === this.chunk.cx && Math.floor(y / CHUNK) === this.chunk.cy) this.chunk.a[(y % CHUNK) * CHUNK + (x % CHUNK)] = m.u[i + 2]; }
    });
    await new Promise((r) => this.ws.on('open', r));
    this.send({ t: 'hello', name: this.name, v: 'test' }); while (!this.id) await sleep(20);
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  tile(x, y) { return this.chunk.a[(y - this.chunk.cy * CHUNK) * CHUNK + (x - this.chunk.cx * CHUNK)]; }
  async build(tool, x, y) { const n = this.toasts.length; this.send({ t: 'build', tool, x, y }); await sleep(250); return this.toasts.slice(n); }
  async settle(cx, cy, w, h) {
    for (const [sx, sy] of [[cx, cy], [cx + 6, cy + 2], [cx - 8, cy + 4], [cx + 12, cy - 3]]) {
      this.spot = null; this.send({ t: 'findFree', cx: sx, cy: sy }); while (!this.spot) await sleep(20);
      if (this.spot.cx === null) continue;
      this.chunk = null; this.send({ t: 'sub', chunks: [[this.spot.cx, this.spot.cy]] }); while (!this.chunk) await sleep(20);
      for (let y = 2; y < 62 - h; y++) for (let x = 2; x < 62 - w; x++) {
        let ok = true; for (let dy = 0; dy < h && ok; dy++) for (let dx = 0; dx < w; dx++) if (isWater(this.chunk.a[(y + dy) * CHUNK + x + dx] & LOMASK)) { ok = false; break; }
        if (ok) { this.send({ t: 'claim', cx: this.spot.cx, cy: this.spot.cy }); await sleep(300); this.send({ t: 'devFunds', amount: 200000 }); await sleep(200); return { X: this.spot.cx * CHUNK + x, Y: this.spot.cy * CHUNK + y }; }
      }
    }
    fail('no dry site');
  }
}
const ticks = (n) => sleep(n * TICK);
// --- 1. city hall: locked, unlock by milestone, one per city, rebuildable ---
const A = new C('Mayor-A'); await A.connect();
const a = await A.settle(70, 14, 20, 12);
await A.build('residential', a.X + 15, a.Y + 9); // a city with a zone, so it is simulated
let t = await A.build('cityhall', a.X + 1, a.Y + 1);
console.log('city hall at 0 people:', t.join(' | '));
if (!t.some((x) => /unlocks at 2,000 people/.test(x))) fail('city hall should be locked');
A.send({ t: 'devPeak', pop: 2500 }); await ticks(3);
console.log('after reaching 2,500: unlocked', JSON.stringify(A.stats.unlocked), '| next milestone', A.stats.nextMilestone, '| toast:', A.toasts.find((x) => /Milestone/.test(x)));
if (!A.stats.unlocked.includes('cityhall') || A.stats.unlocked.includes('seaport')) fail('unlock set');
if (!A.toasts.some((x) => /Milestone: 2,000 people/.test(x))) fail('no milestone message');
t = await A.build('cityhall', a.X + 1, a.Y + 1);
if (!((A.tile(a.X + 1, a.Y + 1) & LOMASK) === CITYHALL && (A.tile(a.X + 1, a.Y + 1) & ZONEBIT))) fail('city hall not placed: ' + t.join(' | '));
t = await A.build('cityhall', a.X + 7, a.Y + 1);
console.log('second city hall:', t.join(' | '));
if (!t.some((x) => /already has a city hall/.test(x))) fail('second city hall should be refused');
await ticks(2);
if (A.stats.built.cityhall !== 1) fail('built count');
await A.build('bulldozer', a.X + 1, a.Y + 1); await ticks(2);
if (A.stats.built.cityhall !== 0) fail('city hall should be gone');
t = await A.build('cityhall', a.X + 7, a.Y + 1);
if ((A.tile(a.X + 7, a.Y + 1) & LOMASK) !== CITYHALL) fail('rebuild refused: ' + t.join(' | '));
console.log('destroyed city hall rebuilt: ok');
// --- 2. grandfathering: a pre-milestone city with two airports keeps both, can't add a third ---
const B = new C('Mayor-B'); await B.connect();
const b = await B.settle(90, 20, 14, 8);
B.send({ t: 'devPlace', tool: 'airport', x: b.X + 1, y: b.Y + 1 }); await sleep(200);
B.send({ t: 'devPlace', tool: 'airport', x: b.X + 8, y: b.Y + 1 }); await sleep(200);
await ticks(3);
console.log('pre-milestone airports:', B.stats.built.airport, '| unlocked', JSON.stringify(B.stats.unlocked), '| peak', B.stats.peakPop);
if (B.stats.built.airport !== 2 || !B.stats.unlocked.includes('airport')) fail('grandfathering');
t = await B.build('airport', b.X + 1, b.Y + 8 > 60 ? b.Y : b.Y + 8);
if (!t.some((x) => /already has an? airport/.test(x))) fail('third airport should be refused: ' + t.join(' | '));
console.log('third airport refused: ok');
// --- 3. rail counts as transport access ---
const R = new C('Mayor-R'); await R.connect();
const r = await R.settle(110, 22, 16, 8);
await R.build('coal', r.X + 1, r.Y + 1);
for (let x = r.X + 4; x < r.X + 9; x++) await R.build('wire', x, r.Y + 1);
await R.build('residential', r.X + 10, r.Y + 1);
for (let x = r.X; x < r.X + 14; x++) await R.build('rail', x, r.Y + 4); // rail along the zone, no road anywhere
let grew = false;
for (let k = 0; k < 40 && !grew; k++) { R.send({ t: 'ping' }); await ticks(1); grew = (R.stats?.population ?? 0) > 0; }
console.log('rail-only zone population:', R.stats.population);
if (!grew) fail('zone with only rail access did not grow');
console.log('PASS'); process.exit(0);
