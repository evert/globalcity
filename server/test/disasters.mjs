// Natural disasters (shared/src/disasters.ts), started with the devDisaster hook: every kind starts, announces
// itself to the mayor and shows in the 'disasters' list; earthquakes and tornadoes leave rubble; blizzards bring
// power lines down; wildfires burn; floods cover low land by the water and then recede; the neighbouring city is
// never touched, but its mayor hears the news.
import WebSocket from 'ws';
import { decodeChunk, Disaster } from '@globalcity/shared';
const URL = `ws://127.0.0.1:${process.env.PORT}/ws`;
const CHUNK = 64,
  LOMASK = 0x3ff,
  TICK = Number(process.env.TICK_MS) || 500;
const isWater = (t) => t >= 2 && t <= 20,
  isRubble = (t) => t >= 44 && t <= 47,
  isFlood = (t) => t >= 48 && t <= 51,
  isFire = (t) => t >= 56 && t <= 63;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => {
  console.log('FAIL:', m);
  process.exit(1);
};

class C {
  constructor(name) {
    this.name = name;
    this.toasts = [];
    this.chunks = new Map();
    this.disasters = [];
    this.seen = [];
  }
  async connect() {
    this.ws = new WebSocket(URL);
    this.ws.binaryType = 'arraybuffer';
    this.ws.on('message', (d, bin) => {
      if (bin) {
        const f = decodeChunk(d instanceof ArrayBuffer ? d : d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));
        this.chunks.set(`${f.cx},${f.cy}`, f.tiles);
        return;
      }
      const m = JSON.parse(d.toString());
      if (m.t === 'welcome') this.me = m.player;
      else if (m.t === 'freeSpot') this.spot = m;
      else if (m.t === 'toast') this.toasts.push(`${m.kind}: ${m.msg}`);
      else if (m.t === 'disasters') {
        this.disasters = m.list;
        this.seen.push(...m.list);
      } else if (m.t === 'tiles')
        for (let i = 0; i < m.u.length; i += 3) {
          const x = m.u[i],
            y = m.u[i + 1],
            a = this.chunks.get(`${Math.floor(x / CHUNK)},${Math.floor(y / CHUNK)}`);
          if (a) a[(y % CHUNK) * CHUNK + (x % CHUNK)] = m.u[i + 2];
        }
    });
    await new Promise((r) => this.ws.on('open', r));
    this.send({ t: 'hello', name: this.name, v: 'test' });
    while (!this.me) await sleep(20);
  }
  send(m) {
    this.ws.send(JSON.stringify(m));
  }
  async findFree(cx, cy) {
    this.spot = null;
    this.send({ t: 'findFree', cx, cy });
    while (!this.spot) await sleep(20);
    return this.spot;
  }
  count(cx, cy, pred) {
    const a = this.chunks.get(`${cx},${cy}`);
    let n = 0;
    for (let i = 0; i < a.length; i++) if (pred(a[i] & LOMASK)) n++;
    return n;
  }
}

const A = new C('Stricken'),
  B = new C('Neighbour');
await A.connect();
await B.connect();
// a coastal plot west of Amsterdam: low land by the sea, for the flood
const s = await A.findFree(131, 26); // Zandvoort, on the Dutch coast
A.send({
  t: 'sub',
  chunks: [
    [s.cx, s.cy],
    [s.cx + 1, s.cy],
  ],
});
while (!A.chunks.has(`${s.cx},${s.cy}`)) await sleep(20);
A.send({ t: 'claim', cx: s.cx, cy: s.cy });
await sleep(300);
const sb = await B.findFree(s.cx + 1, s.cy);
B.send({ t: 'claim', cx: sb.cx, cy: sb.cy });
await sleep(300);
B.send({ t: 'sub', chunks: [[sb.cx, sb.cy]] });
while (!B.chunks.has(`${sb.cx},${sb.cy}`)) await sleep(20);
A.send({ t: 'devFunds', amount: 200000 });
await sleep(200);
// a town on A's plot: a power line grid and residential zones on dry land
const a = A.chunks.get(`${s.cx},${s.cy}`);
const dry = (x, y) => !isWater(a[y * CHUNK + x] & LOMASK);
let built = 0;
// (builds are rate-limited per socket, so pace them like a player painting)
for (let y = 2; y < 62; y += 5)
  for (let x = 2; x < 62; x += 5) {
    if (!dry(x, y) || !dry(x - 1, y - 1) || !dry(x + 1, y + 1)) continue;
    A.send({ t: 'build', tool: 'residential', x: s.cx * CHUNK + x, y: s.cy * CHUNK + y });
    built++;
    await sleep(30);
  }
// a power line along the driest row between the zones (the plot's edge rows can be mostly sea)
let wireY = 0,
  best = -1;
for (let y = 0; y < 62; y += 5) {
  let d = 0;
  for (let x = 1; x < 63; x++) if (dry(x, y)) d++;
  if (d > best) {
    best = d;
    wireY = y;
  }
}
for (let x = 1; x < 63; x++)
  if (dry(x, wireY)) {
    A.send({ t: 'build', tool: 'wire', x: s.cx * CHUNK + x, y: s.cy * CHUNK + wireY });
    await sleep(30);
  }
await sleep(1000);
console.log(`town: ${built} zones, ${A.count(s.cx, s.cy, (t) => t >= 210 && t <= 220)} power line tiles`);
const bBefore = Array.from(B.chunks.get(`${sb.cx},${sb.cy}`)).join(',');

async function strike(kind, name, waitTicks) {
  const n = A.toasts.length,
    seenBefore = A.seen.length;
  A.send({ t: 'devDisaster', kind });
  await sleep(400);
  const toasts = A.toasts.slice(n);
  if (!toasts.some((t) => t.startsWith('error: ') && t.endsWith('!'))) fail(`${name}: no announcement (${toasts.join(' / ')})`);
  if (!A.seen.slice(seenBefore).some((d) => d.kind === kind && d.ownerId === A.me.id)) fail(`${name}: not in the disasters list`);
  console.log(`${name}: ${toasts.find((t) => t.startsWith('error: '))}`);
  await sleep(waitTicks * TICK);
}

// the blizzard first, while the power line is whole (an earthquake can take all of it down)
const wires0 = A.count(s.cx, s.cy, (t) => t >= 210 && t <= 220);
await strike(Disaster.Blizzard, 'blizzard', 30);
const wires1 = A.count(s.cx, s.cy, (t) => t >= 210 && t <= 220);
console.log(`  power line tiles ${wires0} -> ${wires1}`);
if (wires1 >= wires0) fail('the blizzard brought no power lines down');

const rubble0 = A.count(s.cx, s.cy, isRubble);
await strike(Disaster.Earthquake, 'earthquake', 4);
const rubble1 = A.count(s.cx, s.cy, isRubble);
console.log(`  rubble ${rubble0} -> ${rubble1}, fires ${A.count(s.cx, s.cy, isFire)}`);
if (rubble1 <= rubble0) fail('the earthquake left no rubble');

const r2 = A.count(s.cx, s.cy, isRubble);
await strike(Disaster.Tornado, 'tornado', 4);
const path = A.seen.filter((d) => d.kind === Disaster.Tornado).map((d) => `${d.x.toFixed(0)},${d.y.toFixed(0)}`);
await sleep(30 * TICK);
console.log(`  tornado moved through ${new Set(path).size} spots, rubble ${r2} -> ${A.count(s.cx, s.cy, isRubble)}`);
if (new Set(path).size < 3) fail('the tornado did not move');

await strike(Disaster.Wildfire, 'wildfire', 1);
console.log(`  fires burning: ${A.count(s.cx, s.cy, isFire)}`);

await strike(Disaster.Flood, 'flood', 8);
const flooded = A.count(s.cx, s.cy, isFlood);
console.log(`  flooded tiles after 8 steps: ${flooded}`);
if (flooded === 0) fail('the flood covered nothing (this plot should have low land by the water)');
for (let k = 0; k < 120 && A.count(s.cx, s.cy, isFlood) > 0; k++) await sleep(TICK);
const left = A.count(s.cx, s.cy, isFlood);
console.log(`  flood tiles left after it receded: ${left}`);
if (left > 0) fail('the flood did not recede');

await strike(Disaster.Storm, 'storm', 6);

// the neighbour's plot is untouched by all of it
if (Array.from(B.chunks.get(`${sb.cx},${sb.cy}`)).join(',') !== bBefore) fail("disasters in A's city changed B's plot");
const news = B.toasts.filter((t) => t.startsWith('info: ') && /earthquake|tornado|blizzard|flood|storm|wildfire/i.test(t));
console.log(`B heard: ${news.length} disasters (${news[0]})`);
if (news.length < 6) fail(`B should have heard about all 6 disasters, heard ${news.length}`);
if (A.toasts.some((t) => t.startsWith('info: ') && /shook|touched down|buried|spreading|rising|hit/.test(t) && !/devDisaster/.test(t)))
  fail("A got the bystanders' news as well as its own");
console.log('disasters OK');
process.exit(0);
