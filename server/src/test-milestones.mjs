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
if (!t.some((x) => /unlocks at 75,000 people/.test(x))) fail('city hall should be locked');
A.send({ t: 'devPeak', pop: 80000 }); await ticks(3);
console.log('after reaching 2,500: unlocked', JSON.stringify(A.stats.unlocked), '| next milestone', A.stats.nextMilestone, '| toast:', A.toasts.find((x) => /Milestone/.test(x)));
if (!A.stats.unlocked.includes('cityhall') || A.stats.unlocked.includes('seaport')) fail('unlock set');
if (!A.toasts.some((x) => /Milestone: 75,000 people/.test(x))) fail('no milestone message');
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
const b = await B.settle(90, 20, 15, 15);
B.send({ t: 'devPlace', tool: 'airport', x: b.X + 1, y: b.Y + 1 }); await sleep(200);
B.send({ t: 'devPlace', tool: 'airport', x: b.X + 8, y: b.Y + 1 }); await sleep(200);
await ticks(3);
console.log('pre-milestone airports:', B.stats.built.airport, '| unlocked', JSON.stringify(B.stats.unlocked), '| peak', B.stats.peakPop);
if (B.stats.built.airport !== 2 || !B.stats.unlocked.includes('airport')) fail('grandfathering');
B.send({ t: 'devFunds', amount: 50000 }); await sleep(200);
t = await B.build('airport', b.X + 1, b.Y + 8);
await ticks(2);
console.log('third airport (no per-city limit any more):', t.join(' | ') || 'placed', '| airports now', B.stats.built.airport);
if (t.some((x) => /^error/.test(x))) fail('third airport should be allowed');
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
// --- 4. early milestones, wind and offshore power, no fires before the fire milestone ---
const W = new C('Mayor-W'); await W.connect();
const w = await W.settle(66, 18, 20, 10);
t = await W.build('fire', w.X + 1, w.Y + 1);
console.log('fire station at 0 people:', t.join(' | '));
if (!t.some((x) => /unlocks at 15,000 people/.test(x))) fail('fire station should be locked below 15,000');
// a row of road in a city below the fire milestone: an ignited tile must not spread
for (let x = w.X; x < w.X + 12; x++) await W.build('road', x, w.Y + 8);
W.send({ t: 'devIgnite', x: w.X + 6, y: w.Y + 8 }); await ticks(14);
let burnt = 0; for (let x = w.X; x < w.X + 12; x++) { const id = W.tile(x, w.Y + 8) & LOMASK; if (!(id >= 64 && id <= 206)) burnt++; }
console.log('road tiles lost to a fire in a city below 15,000 people:', burnt);
if (burnt > 1) fail('fire spread in a city that has not reached the fire milestone');
W.send({ t: 'devPeak', pop: 60000 }); await ticks(2);
console.log('at 60,000 people unlocked:', JSON.stringify(W.stats.unlocked));
for (const b of ['fire', 'police', 'school']) if (!W.stats.unlocked.includes(b)) fail('missing unlock ' + b);
for (const b of ['cityhall', 'windfarm', 'airport']) if (W.stats.unlocked.includes(b)) fail(b + ' should still be locked at 60,000');
W.send({ t: 'devPeak', pop: 160000 }); await ticks(2);   // the wind farm unlocks at 150,000
if (!W.stats.unlocked.includes('windfarm')) fail('wind farm should unlock at 150,000');
await W.build('residential', w.X + 15, w.Y + 2); // keep the city simulated
t = await W.build('windfarm', w.X + 1, w.Y + 2);
await ticks(3);
console.log('wind farm:', t.join(' | ') || 'placed', '| power supply', W.stats.powerSupply);
if (W.stats.powerSupply < 100) fail('wind farm should supply 100');
// offshore: needs 300,000 and a 4x4 of water
const O = new C('Mayor-O'); await O.connect();
let site = null;
for (const [cx, cy] of [[64, 13], [63, 12], [70, 12], [36, 17], [33, 16], [114, 25], [60, 14]]) {
  O.spot = null; O.send({ t: 'findFree', cx, cy }); while (!O.spot) await sleep(20); if (O.spot.cx === null) continue;
  O.chunk = null; O.send({ t: 'sub', chunks: [[O.spot.cx, O.spot.cy]] }); while (!O.chunk) await sleep(20);
  let wet = null, dry = null;
  for (let y = 2; y < 58 && !wet; y++) for (let x = 2; x < 58 && !wet; x++) {
    let ok = true; for (let dy = 0; dy < 4 && ok; dy++) for (let dx = 0; dx < 4; dx++) if (!isWater(O.chunk.a[(y + dy) * 64 + x + dx] & LOMASK)) { ok = false; break; }
    if (ok) wet = { x: O.spot.cx * 64 + x, y: O.spot.cy * 64 + y };
  }
  for (let y = 2; y < 58 && !dry; y++) for (let x = 2; x < 58 && !dry; x++) {
    let ok = true; for (let dy = 0; dy < 4 && ok; dy++) for (let dx = 0; dx < 4; dx++) if (isWater(O.chunk.a[(y + dy) * 64 + x + dx] & LOMASK)) { ok = false; break; }
    if (ok) dry = { x: O.spot.cx * 64 + x, y: O.spot.cy * 64 + y };
  }
  if (wet && dry) { site = { wet, dry }; O.send({ t: 'claim', cx: O.spot.cx, cy: O.spot.cy }); await sleep(300); break; }
}
if (!site) fail('no coastal plot with a 4x4 of open water');
O.send({ t: 'devFunds', amount: 100000 }); O.send({ t: 'devPeak', pop: 1500000 }); await sleep(300);
t = await O.build('offshore', site.dry.x + 1, site.dry.y + 1);
console.log('offshore on land:', t.join(' | '));
if (!t.some((x) => /entirely on water/.test(x))) fail('offshore must be refused on land');
t = await O.build('offshore', site.wet.x + 1, site.wet.y + 1);
const OFFSHORE = 1006;
if ((O.tile(site.wet.x + 1, site.wet.y + 1) & LOMASK) !== OFFSHORE) fail('offshore not placed on water: ' + t.join(' | '));
console.log('offshore on water: placed');
await O.build('bulldozer', site.wet.x + 1, site.wet.y + 1);
let water = 0; for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) if (isWater(O.tile(site.wet.x + dx, site.wet.y + dy) & LOMASK)) water++;
console.log('after bulldozing the offshore farm, water tiles:', water, 'of 16');
if (water !== 16) fail('bulldozed offshore farm should leave water');
console.log('PASS'); process.exit(0);
