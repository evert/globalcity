// GlobalCity server entry point: boots the world, loads saves, starts networking and the sim clock.
//
// Environment:
//   PORT       listen port (default 8787)          HOST      bind address (default 0.0.0.0)
//   DATA_DIR   save directory, relative to the repo root (default data/save)
//   TICK_MS    simulation step length in ms (default TICK_MS from shared; shorten for tests)
//   STEPS_PER_MONTH  simulation steps per game month (default STEPS_PER_MONTH from shared; tests use 1)
//   DEV_HOOKS  "1" enables dev-only hooks: the {t:'devIgnite',x,y} socket message starts a fire,
//              {t:'devFunds',amount} grants money, and random fire outbreaks are disabled so tests are
//              deterministic. Never set in production.
//   SEASON_MONTH  1..12: pretend it is this month for seasonal buildings (the Christmas tree is December only);
//              default the real month (UTC)
//   ABANDON_DAY_MS  length of an abandonment "day" in ms (default 86400000; tests use 1000)
//   ALL_ONLINE  "1": every mayor counts as online all the time (no frozen cities, disasters anywhere), to see how
//              a full world simulates. Test saves only: it keeps every city from going idle or being released.
//   DISASTER_TRIGGER  "1": players get a test dialog to start any disaster in any city right away (test servers).
//   DISASTER_EVERY_MS  a disaster strikes this often (when a city can be struck) instead of about one every two
//              hours; for testing (e.g. 120000). Disasters never strike with DEV_HOOKS.
//   NOTIFY_DB  world reset notification sign-ups (SQLite; default notify.db beside the save directory, so it
//              survives the world reset)

import os from 'node:os';
import path from 'node:path';
import { TICK_MS, DEFAULT_PORT, WORLD_W, WORLD_H, CHUNKS_X, CHUNKS_Y, WORLD_TAG, STEPS_PER_MONTH } from '@globalcity/shared';
import { bootWorld } from './world.ts';
import { Players } from './players.ts';
import { Places } from './places.ts';
import { Persist } from './persist.ts';
import { Sim } from './sim.ts';
import { Net } from './net.ts';
import { MapTiles } from './maptiles.ts';
import { Elevation } from './elevation.ts';
import fs from 'node:fs';
import { Notify } from './notify.ts';
import { log, warn, timed } from './util.ts';

const TILE_FLUSH_MS = 100;
/** How often the zoomed-out map catches up with what was built. */
const MAP_REFRESH_MS = 10_000;

const root = path.resolve(import.meta.dirname, '../..');
const worldDir = path.join(root, `data/world-${WORLD_TAG}`);
const baseFile = path.join(worldDir, 'base.bin');
const placesFile = path.join(worldDir, 'places.json');
const saveDir = path.resolve(root, process.env.DATA_DIR || 'data/save');
const clientDist = path.join(root, 'client/dist');
const port = Number(process.env.PORT) || DEFAULT_PORT;
const host = process.env.HOST || '0.0.0.0';
const tickMs = Number(process.env.TICK_MS) || TICK_MS;
const devHooks = process.env.DEV_HOOKS === '1';
const dayMs = Number(process.env.ABANDON_DAY_MS) || 86_400_000;

const t0 = performance.now();
const world = bootWorld(baseFile);
const places = new Places();
places.load(placesFile);
const players = new Players(world, places, { dayMs });
const persist = new Persist(world, players, saveDir);
const hadState = persist.loadState();
const chunksLoaded = timed('Overlay saved chunks', () => persist.loadChunks());
log(
  `State: ${hadState ? `${players.players.size} players, ${players.claims.size} claims` : 'fresh'}; ${chunksLoaded} saved chunk(s); clock ${players.time.year}-${String(players.time.month + 1).padStart(2, '0')}`,
);

const worldId = (() => {
  try {
    return String(JSON.parse(fs.readFileSync(path.join(worldDir, 'base.json'), 'utf8')).generatedAt);
  } catch {
    return 'fallback';
  }
})();
const mapTiles = timed('Map tiles', () => new MapTiles(world, worldId));
// which disasters can strike where (a byte per chunk) and the elevation of every tile, from the world generator
const hazards = (() => {
  const f = path.join(worldDir, 'hazards.bin');
  if (!fs.existsSync(f)) {
    warn(`${f} not found: no natural disasters (regenerate the world)`);
    return undefined;
  }
  return new Uint8Array(fs.readFileSync(f));
})();
const elevation = new Elevation(path.join(worldDir, 'elevation.bin'));
const sim = new Sim(world, players, { randomFires: !devHooks, hazards, elevation });
const notify = new Notify(path.resolve(root, process.env.NOTIFY_DB || path.join(path.dirname(saveDir), 'notify.db')), devHooks);
const net = new Net(world, players, sim, clientDist, root, { devHooks, dataDir: saveDir, mapTiles, notify });
try {
  await net.listen(port, host);
} catch (e) {
  const err = e as NodeJS.ErrnoException;
  warn(err.code === 'EADDRINUSE' ? `Port ${port} is already in use (another server running? set PORT=...)` : `Could not listen on ${port}: ${err.message}`);
  process.exit(1);
}
persist.start();

const tickTimer = setInterval(() => {
  const t = performance.now();
  const result = sim.tick();
  net.afterTick(result);
  const dt = performance.now() - t;
  if (dt > tickMs / 2) warn(`Slow tick #${sim.tickCount}: ${dt.toFixed(0)} ms`);
}, tickMs);
const flushTimer = setInterval(() => net.flushTiles(), TILE_FLUSH_MS);
const mapTimer = setInterval(() => mapTiles.refresh(), MAP_REFRESH_MS);

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`${signal} received, saving...`);
  clearInterval(tickTimer);
  clearInterval(flushTimer);
  persist.stop();
  try {
    const r = persist.flush();
    log(`Saved ${r.chunks} chunk(s)${r.state ? ' and state.json' : ''}`);
  } catch (e) {
    warn('Final save failed:', e);
  }
  net.close();
  setTimeout(() => process.exit(0), 200).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

log(`Boot complete in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
console.log(`
  GlobalCity server
  -----------------
  World      ${WORLD_W} x ${WORLD_H} tiles, ${CHUNKS_X} x ${CHUNKS_Y} chunks
  Listening  ${host}:${port}
  WebSocket  ws://localhost:${port}/ws
  HTTP       http://localhost:${port}/  (health: /health, /ATTRIBUTION.md)
${lanUrls()
  .map((u) => `  LAN        ${u}`)
  .join('\n')}
  Save dir   ${saveDir}
  Tick       every ${tickMs} ms = one simulation step (${Number(process.env.STEPS_PER_MONTH) || STEPS_PER_MONTH} to a game month)${devHooks ? '\n  DEV_HOOKS  enabled (devIgnite/devFunds accepted, random fires off)' : ''}${dayMs !== 86_400_000 ? `\n  Day        ${dayMs} ms (ABANDON_DAY_MS)` : ''}
`);

/** http:// URLs for every non-internal IPv4 interface, for reaching the server from the LAN. */
function lanUrls(): string[] {
  if (host !== '0.0.0.0' && host !== '::') return [`http://${host}:${port}/`];
  const out: string[] = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces ?? []) if (i.family === 'IPv4' && !i.internal) out.push(`http://${i.address}:${port}/`);
  }
  return out.length ? out : ['(no LAN interfaces found)'];
}
