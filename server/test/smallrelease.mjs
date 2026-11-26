// A city with fewer than SMALL_CITY_MAX_ITEMS things built is released once its mayor has been away
// SMALL_CITY_RELEASE_MS; a city with more is kept; the mayor is told why on the next visit.
// Run the server with SMALL_CITY_RELEASE_MS=3000.
import WebSocket from 'ws';
const PORT = process.env.PORT, WAIT = Number(process.env.SMALL_CITY_RELEASE_MS) || 3000, TICK = Number(process.env.TICK_MS) || 500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => { console.log('FAIL:', m); process.exit(1); };
class C {
  constructor(name) { this.name = name; this.unclaims = []; this.toasts = []; this.spot = null; this.chunk = null; }
  async connect(id, token) {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`); this.ws.binaryType = 'arraybuffer';
    this.ws.on('message', (d, bin) => {
      if (bin) { this.chunk = true; return; }
      const m = JSON.parse(d.toString());
      if (m.t === 'welcome') { this.id = m.player.id; this.token = m.player.token; this.chunks = m.stats.chunks; }
      else if (m.t === 'unclaim') this.unclaims.push(`${m.cx},${m.cy}`);
      else if (m.t === 'freeSpot') this.spot = m;
      else if (m.t === 'toast') this.toasts.push(m.msg);
    });
    await new Promise((r) => this.ws.on('open', r));
    this.id = null; this.send(id ? { t: 'hello', id, token, name: this.name } : { t: 'hello', name: this.name });
    while (!this.id) await sleep(20);
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  async settle(cx, cy) {
    this.spot = null; this.send({ t: 'findFree', cx, cy }); while (!this.spot) await sleep(20);
    this.send({ t: 'claim', cx: this.spot.cx, cy: this.spot.cy }); await sleep(300);
    return this.spot;
  }
}
const W = new C('Watcher'), S = new C('Small'), B = new C('Builder');
await W.connect(); await S.connect(); await B.connect();
const s = await S.settle(70, 14), b = await B.settle(90, 20);
// Small builds 3 road tiles; Builder builds 6
for (let k = 0; k < 3; k++) { S.send({ t: 'build', tool: 'road', x: s.cx * 64 + 10 + k, y: s.cy * 64 + 10 }); await sleep(40); }
for (let k = 0; k < 6; k++) { B.send({ t: 'build', tool: 'road', x: b.cx * 64 + 10 + k, y: b.cy * 64 + 10 }); await sleep(40); }
await sleep(300);
const sId = S.id, sTok = S.token;
S.ws.close(); B.ws.close();
const t0 = Date.now();
while (Date.now() - t0 < WAIT + 8 * TICK && !W.unclaims.includes(`${s.cx},${s.cy}`)) { W.send({ t: 'ping' }); await sleep(TICK); }
console.log(`after ${((Date.now() - t0) / 1000).toFixed(1)} s away: small city released ${W.unclaims.includes(`${s.cx},${s.cy}`)}, bigger city released ${W.unclaims.includes(`${b.cx},${b.cy}`)}`);
if (!W.unclaims.includes(`${s.cx},${s.cy}`)) fail('small city was not released');
for (let k = 0; k < 4; k++) { W.send({ t: 'ping' }); await sleep(TICK); }
if (W.unclaims.includes(`${b.cx},${b.cy}`)) fail('city with 6 things built was released');
// the small mayor comes back and is told why
const S2 = new C('Small'); await S2.connect(sId, sTok); await sleep(400);
console.log('returning mayor sees:', S2.toasts[0], '| plots:', S2.chunks);
if (!S2.toasts.some((t) => /released because fewer than 5/.test(t))) fail('no notice on return');
const S3 = new C('Small'); await S3.connect(sId, sTok); await sleep(400);
if (S3.toasts.some((t) => /released because/.test(t))) fail('notice shown twice');
console.log('PASS'); process.exit(0);
