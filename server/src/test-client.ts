// Smoke test: connect, found a city near London, build a small powered neighbourhood, verify stats flow.
// Usage: npm run smoke -w server   (server must be running; PORT env overrides 8787). Exit 0 = pass.

import WebSocket from 'ws';
import {
  DEFAULT_PORT, CHUNK, STARTING_FUNDS, LOMASK,
  lonLatToTile, chunkOf, decodeChunk, isWater, isTree,
  type ClientMsg, type ServerMsg, type PlayerStats,
} from '@globalcity/shared';

const port = Number(process.env.PORT) || DEFAULT_PORT;
const url = `ws://localhost:${port}/ws`;
const WAIT_MS = 15_000;

const ws = new WebSocket(url);
const send = (m: ClientMsg): void => { ws.send(JSON.stringify(m)); };

let chunk: { cx: number; cy: number; tiles: Uint16Array } | null = null;
let statsCount = 0;
let lastStats: PlayerStats | null = null;
let tileUpdates = 0;
const toasts: string[] = [];
let ownerId = '';

const waitFor = <T>(pred: () => T | null | undefined | false, label: string, ms = 5000): Promise<T> =>
  new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      const v = pred();
      if (v) { clearInterval(iv); resolve(v); }
      else if (Date.now() - t0 > ms) { clearInterval(iv); reject(new Error(`timeout waiting for ${label}`)); }
    }, 20);
  });

const welcome = new Promise<Extract<ServerMsg, { t: 'welcome' }>>((resolve) => {
  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      const buf = data as Buffer;
      const ab = new ArrayBuffer(buf.byteLength);
      new Uint8Array(ab).set(buf);
      const c = decodeChunk(ab);
      if (c) chunk = c;
      return;
    }
    const msg = JSON.parse(data.toString()) as ServerMsg;
    switch (msg.t) {
      case 'welcome': ownerId = msg.player.id; resolve(msg); break;
      case 'stats': statsCount++; lastStats = msg.stats; break;
      case 'tiles': tileUpdates += msg.u.length / 3; break;
      case 'toast': toasts.push(`${msg.kind}: ${msg.msg}`); break;
      case 'freeSpot': freeSpot = msg; break;
      case 'claim': if (msg.claim.ownerId === ownerId) claimed = msg.claim; break;
      default: break;
    }
  });
});
let freeSpot: Extract<ServerMsg, { t: 'freeSpot' }> | null = null;
let claimed: { cx: number; cy: number } | null = null;

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  console.error('toasts:', toasts);
  process.exit(1);
}

async function main(): Promise<void> {
  await new Promise<void>((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  send({ t: 'hello', name: 'SmokeTester' });
  const w = await welcome;
  console.log(`welcome: player=${w.player.name} funds=${w.stats.funds} claims=${w.claims.length} online=${w.online} time=${w.time.year}-${w.time.month + 1}`);
  if (w.world.w * 0 !== 0 || w.world.chunk !== CHUNK) fail('bad world dims');

  // Nearest claimable chunk to London.
  const london = lonLatToTile(-0.1, 51.5);
  const lc = chunkOf(london.x, london.y);
  send({ t: 'findFree', cx: lc.cx, cy: lc.cy });
  const spot = await waitFor(() => freeSpot, 'freeSpot');
  if (spot.cx === null || spot.cy === null) fail('no free chunk near London');
  console.log(`London is chunk ${lc.cx},${lc.cy}; nearest free chunk ${spot.cx},${spot.cy}`);

  send({ t: 'claim', cx: spot.cx, cy: spot.cy });
  await waitFor(() => claimed, 'claim broadcast');
  send({ t: 'sub', chunks: [[spot.cx, spot.cy]] });
  const ch = await waitFor(() => chunk, 'chunk frame');
  const { cx, cy } = ch;

  // Find a 15x5 rectangle of land (dirt/trees) for: coal plant (4x4) | 2 wires | 3 res zones; road along row 4 below them.
  const RW = 15, RH = 5;
  let origin: { x: number; y: number } | null = null;
  outer: for (let oy = 1; oy + RH < CHUNK - 1; oy++) {
    for (let ox = 1; ox + RW < CHUNK - 1; ox++) {
      let ok = true;
      for (let dy = 0; dy < RH && ok; dy++) for (let dx = 0; dx < RW; dx++) {
        const v = ch.tiles[(oy + dy) * CHUNK + ox + dx];
        if (isWater(v)) { ok = false; break; }
      }
      if (ok) { origin = { x: cx * CHUNK + ox, y: cy * CHUNK + oy }; break outer; }
    }
  }
  if (!origin) fail('no 15x5 land rectangle in the chunk');
  const { x: X, y: Y } = origin;
  console.log(`building at ${X},${Y}`);

  // Bulldoze trees in the rectangle first (exercises the bulldozer; zones would auto-bulldoze anyway).
  let dozed = 0;
  for (let dy = 0; dy < RH; dy++) for (let dx = 0; dx < RW; dx++) {
    if (isTree(ch.tiles[(Y - cy * CHUNK + dy) * CHUNK + (X - cx * CHUNK + dx)])) { send({ t: 'build', tool: 'bulldozer', x: X + dx, y: Y + dy }); dozed++; }
  }
  await new Promise((r) => setTimeout(r, 300));
  send({ t: 'build', tool: 'coal', x: X + 1, y: Y + 1 });          // footprint X..X+3, Y..Y+3
  send({ t: 'build', tool: 'wire', x: X + 4, y: Y + 1 });
  send({ t: 'build', tool: 'wire', x: X + 5, y: Y + 1 });
  send({ t: 'build', tool: 'residential', x: X + 7, y: Y + 1 });   // X+6..X+8
  send({ t: 'build', tool: 'residential', x: X + 10, y: Y + 1 });  // X+9..X+11
  send({ t: 'build', tool: 'residential', x: X + 13, y: Y + 1 });  // X+12..X+14
  for (let dx = 0; dx < RW; dx++) send({ t: 'build', tool: 'road', x: X + dx, y: Y + 4 });
  send({ t: 'query', x: X + 1, y: Y + 1 });
  send({ t: 'ping' });

  console.log(`waiting ${WAIT_MS / 1000}s for the simulation...`);
  await new Promise((r) => setTimeout(r, WAIT_MS));

  const s = lastStats ?? fail('no stats message received');
  console.log(`stats: funds=${s.funds} pop=${s.population} resPop=${s.resPop} power=${s.powerDemand}/${s.powerSupply} demand=${JSON.stringify(s.demand)} chunks=${s.chunks}`);
  console.log(`tile updates received: ${tileUpdates}; stats messages: ${statsCount}; trees bulldozed: ${dozed}`);
  console.log('toasts:', toasts);
  const expected = STARTING_FUNDS - 3000 - 2 * 5 - 3 * 100 - RW * 10; // minus auto-bulldozing, plus taxes
  if (!(s.funds < STARTING_FUNDS)) fail('funds did not decrease');
  if (s.funds > expected + 200) fail(`funds ${s.funds} higher than expected <= ${expected}`);
  if (tileUpdates < 16 + 2 + 27 + RW) fail(`too few tile updates (${tileUpdates})`);
  if (statsCount < 1) fail('no stats arrived');
  if (s.powerSupply !== 700) fail(`power supply ${s.powerSupply}, expected 700`);
  if (s.powerDemand !== 3) fail(`power demand ${s.powerDemand}, expected 3 (zones not connected to grid?)`);
  if (toasts.some((t) => t.startsWith('error'))) fail('an error toast was received');
  console.log('PASS');
  ws.close();
  process.exit(0);
}

main().catch((e) => fail(String(e)));
