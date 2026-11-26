// Abandoning a city (any city: here a broke one that owes a lifeline): the plots are released (unclaim broadcast)
// and the mayor starts over ($20,000, debt written off), but can't claim the plots they left for a week. Nothing crumbles: the
// town stays as it was, and a new mayor who claims the plot gets it, buildings and all, for the normal plot
// price (the first plot is free), with its power and zones working. Needs DEV_HOOKS=1.
import WebSocket from 'ws';
import { decodeChunk } from '@globalcity/shared';
const PORT = process.env.PORT, TICK = Number(process.env.TICK_MS) || 500;
const LOMASK = 0x3ff, ZONEBIT = 0x400, ROADBASE = 64, isWater = (t) => t >= 2 && t <= 20, isRubble = (t) => t >= 44 && t <= 47;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => { console.log('FAIL:', m); process.exit(1); };

class C {
  constructor(name) { this.name = name; this.toasts = []; this.unclaims = []; this.welcomes = 0; this.chunk = null; }
  async connect() {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`); this.ws.binaryType = 'arraybuffer';
    this.ws.on('message', (d, bin) => {
      if (bin) { const f = decodeChunk(d instanceof ArrayBuffer ? d : d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength)); this.chunk = { cx: f.cx, cy: f.cy, a: f.tiles }; return; }
      const m = JSON.parse(d.toString());
      if (m.t === 'welcome') { this.me = m.player; this.stats = m.stats; this.welcomes++; }
      else if (m.t === 'stats') this.stats = m.stats;
      else if (m.t === 'freeSpot') this.spot = m;
      else if (m.t === 'query') this.query = m.info;
      else if (m.t === 'toast') this.toasts.push(`${m.kind}: ${m.msg}`);
      else if (m.t === 'unclaim') this.unclaims.push(`${m.cx},${m.cy}`);
      else if (m.t === 'tiles' && this.chunk) {
        const { cx, cy, a } = this.chunk;
        for (let i = 0; i < m.u.length; i += 3) { const x = m.u[i], y = m.u[i + 1]; if (Math.floor(x / 64) === cx && Math.floor(y / 64) === cy) a[(y % 64) * 64 + (x % 64)] = m.u[i + 2]; }
      }
    });
    await new Promise((r) => this.ws.on('open', r));
    this.send({ t: 'hello', name: this.name, v: 'test' }); while (!this.me) await sleep(20);
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  last() { return this.toasts[this.toasts.length - 1] ?? ''; }
  async sub(cx, cy) { this.chunk = null; this.send({ t: 'sub', chunks: [[cx, cy]] }); while (!this.chunk) await sleep(20); }
  async ask(x, y) { this.query = null; this.send({ t: 'query', x, y }); while (!this.query) await sleep(20); return this.query; }
}

const A = new C('Unlucky Mayor'), B = new C('Newcomer');
await A.connect(); await B.connect();
A.spot = null; A.send({ t: 'findFree', cx: 150, cy: 30 }); while (!A.spot) await sleep(20);
const spot = A.spot, key = `${spot.cx},${spot.cy}`;
await A.sub(spot.cx, spot.cy); await B.sub(spot.cx, spot.cy);
let X = -1, Y = -1;
for (let y = 3; y < 48 && X < 0; y++) for (let x = 3; x < 40 && X < 0; x++) {
  let ok = true; for (let dy = 0; dy < 12 && ok; dy++) for (let dx = 0; dx < 22; dx++) if (isWater(A.chunk.a[(y + dy) * 64 + x + dx] & LOMASK)) { ok = false; break; }
  if (ok) { X = spot.cx * 64 + x; Y = spot.cy * 64 + y; }
}
if (X < 0) fail('no dry site');
// a small working town: coal plant, a power line, homes and a road
A.send({ t: 'claim', cx: spot.cx, cy: spot.cy }); await sleep(400);
const build = async (tool, x, y) => { A.send({ t: 'build', tool, x, y }); await sleep(40); };
await build('coal', X + 1, Y + 1);
for (let x = X + 4; x < X + 20; x++) await build('wire', x, Y + 1);
for (let i = 0; i < 5; i++) await build('residential', X + 5 + i * 3, Y + 3);
for (let x = X; x < X + 21; x++) await build('road', x, Y + 5);
let t0 = Date.now();
while (!(A.stats?.population > 0) && Date.now() - t0 < 60 * TICK) await sleep(TICK);
if (!(A.stats?.population > 0)) fail('town never grew');
console.log(`town: ${A.stats.population} people`);

A.send({ t: 'devSetFunds', amount: 50 }); await sleep(300);
A.send({ t: 'lifeline' }); await sleep(300);
if (A.stats.debt <= 0) fail('lifeline not taken');
A.send({ t: 'devSetFunds', amount: 50 }); await sleep(300);
const before = A.welcomes;
A.send({ t: 'abandon' }); await sleep(600);
console.log('abandoned:', A.last());
if (!/Anyone can claim its plots and everything built on them/.test(A.last())) fail('abandon toast should say the plots can be claimed with their buildings');
if (A.welcomes !== before + 1) fail('no fresh welcome');
if (A.stats.funds !== 20000 || A.stats.debt !== 0 || A.stats.chunks !== 0) fail('mayor not reset: ' + JSON.stringify({ funds: A.stats.funds, debt: A.stats.debt, chunks: A.stats.chunks }));
if (!B.unclaims.includes(key)) fail('plot not released');
A.send({ t: 'abandon' }); await sleep(300);
if (!/You have no city to abandon/.test(A.last())) fail('abandoning with no plots should be refused: ' + A.last());
// no free restart with the old town: the mayor can't claim the plot they just left
A.send({ t: 'claim', cx: spot.cx, cy: spot.cy }); await sleep(300);
if (!/You left this plot when you abandoned your city: you can claim it again in 7 days/.test(A.last())) fail('reclaiming the left plot should be refused: ' + A.last());
if (A.stats.chunks !== 0) fail('the mayor got their old plot back');

// nothing crumbles: the released town stays as it was
const census = () => { let rubble = 0, zones = 0; for (const v of B.chunk.a) { if (isRubble(v & LOMASK)) rubble++; if (v & ZONEBIT) zones++; } return { rubble, zones }; };
const s0 = Array.from(B.chunk.a, (v) => v & LOMASK), c0 = census();
await sleep(30 * TICK);
const c1 = census();
console.log(`released plot over 30 ticks: ${JSON.stringify(c0)} -> ${JSON.stringify(c1)}`);
if (c1.rubble > c0.rubble) fail('the released town crumbled');
if (c1.zones !== c0.zones || c1.zones < 6) fail(`zones/buildings lost on the released plot (${c0.zones} -> ${c1.zones})`);
let lost = 0; B.chunk.a.forEach((v, i) => { if (s0[i] >= ROADBASE && (v & LOMASK) < ROADBASE) lost++; });
if (lost) fail(`${lost} built tiles turned into rubble or land on the released plot`);

// a new mayor claims the plot and takes over the town, for the normal (here: free first plot) price
const nB = B.toasts.length;
B.send({ t: 'claim', cx: spot.cx, cy: spot.cy }); await sleep(600);
const claimToast = B.toasts.slice(nB).join(' | ');
console.log('newcomer:', claimToast);
if (!/^success: Welcome, Mayor!.*zones and buildings already standing there/.test(claimToast)) fail('claim toast should mention the buildings taken over: ' + claimToast);
if (B.stats.chunks !== 1) fail('newcomer does not own the plot');
// power and zones keep working for the new owner: the homes are powered and people live there
t0 = Date.now();
while (!(B.stats?.population > 0 && B.stats?.powerSupply > 0) && Date.now() - t0 < 20 * TICK) await sleep(TICK);
const home = await B.ask(X + 5, Y + 3);
console.log(`newcomer's town: ${B.stats.population} people, power supply ${B.stats.powerSupply}, home powered ${home.powered}, owner ${home.owner?.name}`);
if (!(B.stats.population > 0)) fail('the taken-over town has no people');
const book = B.stats.budget?.current;
console.log(`newcomer's books this year: plots $${book?.plots}, construction $${book?.construction}`);
if (!book || book.plots !== 0 || book.construction !== 0) fail('newcomer was charged for the plot or its buildings');
if (!(B.stats.powerSupply > 0)) fail('the taken-over coal plant supplies no power');
if (!home.powered) fail('the taken-over homes are not powered');
if (home.owner?.name !== 'Newcomer') fail("the homes are not the newcomer's");
// a city with money can be abandoned too, and its mayor can found a new city somewhere else straight away
const R = new C('Restless Mayor'); await R.connect();
R.spot = null; R.send({ t: 'findFree', cx: 20, cy: 15 }); while (!R.spot) await sleep(20);
R.send({ t: 'claim', cx: R.spot.cx, cy: R.spot.cy }); await sleep(400);
if (R.stats.chunks !== 1) fail('restless mayor has no plot: ' + R.last());
R.send({ t: 'abandon' }); await sleep(400);
if (!/Anyone can claim its plots/.test(R.last()) || R.stats.chunks !== 0) fail('a city with money should be abandonable: ' + R.last());
const left = `${R.spot.cx},${R.spot.cy}`;
R.spot = null; R.send({ t: 'findFree', cx: 30, cy: 15 }); while (!R.spot) await sleep(20);
if (`${R.spot.cx},${R.spot.cy}` === left) fail('findFree offered the plot just left');
R.send({ t: 'claim', cx: R.spot.cx, cy: R.spot.cy }); await sleep(400);
if (R.stats.chunks !== 1) fail('could not found a new city elsewhere: ' + R.last());
console.log('restless mayor abandoned a rich city and founded a new one elsewhere');
console.log('PASS'); process.exit(0);
