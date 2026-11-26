// Monuments: a city above MONUMENT_MIN_POP can be retired as a monument. The plots pass to a frozen monument
// record (same names, flagged in claims, off the leaderboard, never claimable), the mayor gets a fresh start
// (starting funds, no plots) and can found a new city. Run the server with MONUMENT_MIN_POP=1 (and DEV_HOOKS=1).
import WebSocket from 'ws';
import { decodeChunk } from '@globalcity/shared';
const PORT = process.env.PORT, TICK = Number(process.env.TICK_MS) || 500;
const LOMASK = 0x3ff, isWater = (t) => t >= 2 && t <= 20;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => { console.log('FAIL:', m); process.exit(1); };

class C {
  constructor(name) { this.name = name; this.toasts = []; this.claims = new Map(); this.lb = null; }
  async connect() {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`); this.ws.binaryType = 'arraybuffer';
    this.ws.on('message', (d, bin) => {
      if (bin) { const f = decodeChunk(d instanceof ArrayBuffer ? d : d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength)); this.chunk = { cx: f.cx, cy: f.cy, a: f.tiles }; return; }
      const m = JSON.parse(d.toString());
      if (m.t === 'welcome') { this.me = m.player; this.stats = m.stats; this.welcomes = (this.welcomes ?? 0) + 1; this.claims = new Map(m.claims.map((c) => [`${c.cx},${c.cy}`, c])); }
      else if (m.t === 'stats') this.stats = m.stats;
      else if (m.t === 'claims') for (const c of m.claims) this.claims.set(`${c.cx},${c.cy}`, c);
      else if (m.t === 'freeSpot') this.spot = m;
      else if (m.t === 'leaderboard') this.lb = m;
      else if (m.t === 'toast') this.toasts.push(`${m.kind}: ${m.msg}`);
    });
    await new Promise((r) => this.ws.on('open', r));
    this.send({ t: 'hello', name: this.name, v: 'test' }); while (!this.me) await sleep(20);
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  async findFree(cx, cy) { this.spot = null; this.send({ t: 'findFree', cx, cy }); while (!this.spot) await sleep(20); return this.spot; }
}

const A = new C('Builder'), B = new C('Onlooker');
await A.connect(); await B.connect();
// found a small working town (coal, wire, homes, a road) and wait for people to move in
const s = await A.findFree(150, 30);
A.chunk = null; A.send({ t: 'sub', chunks: [[s.cx, s.cy]] }); while (!A.chunk) await sleep(20);
let X = -1, Y = -1;
for (let y = 3; y < 48 && X < 0; y++) for (let x = 3; x < 40 && X < 0; x++) {
  let ok = true; for (let dy = 0; dy < 12 && ok; dy++) for (let dx = 0; dx < 22; dx++) if (isWater(A.chunk.a[(y + dy) * 64 + x + dx] & LOMASK)) { ok = false; break; }
  if (ok) { X = s.cx * 64 + x; Y = s.cy * 64 + y; }
}
if (X < 0) fail('no dry site');
A.send({ t: 'claim', cx: s.cx, cy: s.cy }); await sleep(400);
const key = `${s.cx},${s.cy}`;
const build = async (tool, x, y) => { A.send({ t: 'build', tool, x, y }); await sleep(40); };
await build('coal', X + 1, Y + 1);
for (let x = X + 4; x < X + 20; x++) await build('wire', x, Y + 1);
for (let i = 0; i < 5; i++) await build('residential', X + 5 + i * 3, Y + 3);
for (let x = X; x < X + 21; x++) await build('road', x, Y + 5);
const t0 = Date.now();
while (!(A.stats?.population > 0) && Date.now() - t0 < 60 * TICK) await sleep(TICK);
if (!(A.stats?.population > 0)) fail('town never grew');
const cityName = A.claims.get(key)?.cityName;
console.log(`town ${cityName}: ${A.stats.population} people`);

// retire it
const welcomesBefore = A.welcomes;
A.send({ t: 'monument' }); await sleep(600);
console.log('mayor:', A.toasts.at(-1));
if (!A.toasts.some((x) => /is now a monument/.test(x))) fail('no monument confirmation');
if (A.welcomes !== welcomesBefore + 1) fail('no fresh welcome after the monument');
if (A.stats.population !== 0 || A.stats.chunks !== 0 || A.stats.funds !== 20000) fail(`mayor not reset: ${JSON.stringify({ pop: A.stats.population, chunks: A.stats.chunks, funds: A.stats.funds })}`);
const mc = A.claims.get(key);
if (!mc || !mc.monument || mc.ownerId === A.me.id || mc.cityName !== cityName || mc.ownerName !== 'Builder') fail('claim did not pass to the monument: ' + JSON.stringify(mc));
const bc = B.claims.get(key);
if (!bc?.monument) fail('other players were not told about the monument');
if (!B.toasts.some((x) => /retired .* as a monument/.test(x))) fail('no announcement for other players');
console.log('onlooker:', B.toasts.at(-1));

// the monument stays: frozen, never claimable, off the leaderboard
await sleep(TICK * 6);
const after = B.claims.get(key);
if (!after?.monument || after.pop !== mc.pop) fail(`monument changed: ${JSON.stringify(after)}`);
B.send({ t: 'claim', cx: s.cx, cy: s.cy }); await sleep(300);
if (B.claims.get(key)?.ownerId !== mc.ownerId) fail('the monument plot was claimed');
A.send({ t: 'leaderboard' }); await sleep(300);
if ((A.lb?.entries ?? []).some((e) => e.id === mc.ownerId)) fail('monument listed on the leaderboard');

// and the mayor starts over
const s2 = await A.findFree(s.cx + 3, s.cy);
A.send({ t: 'claim', cx: s2.cx, cy: s2.cy });
for (let i = 0; i < 50 && A.claims.get(`${s2.cx},${s2.cy}`)?.ownerId !== A.me.id; i++) await sleep(100); // up to 5 s: a busy machine is slow
const nc = A.claims.get(`${s2.cx},${s2.cy}`);
if (nc?.ownerId !== A.me.id) fail(`mayor could not found a new city at ${s2.cx},${s2.cy}: ${A.toasts.slice(-2).join(' / ')}`);
console.log(`new city: ${nc.cityName} at ${s2.cx},${s2.cy}; funds ${A.stats.funds}`);
console.log('PASS'); process.exit(0);
