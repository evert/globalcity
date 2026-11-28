// GlobalCity server entry point: boots the world, loads saves, starts networking and the sim clock.
//
// Environment:
//   PORT       listen port (default 8787)          HOST      bind address (default 0.0.0.0)
//   DATA_DIR   save directory, relative to the repo root (default data/save)
//   WORLD_DIR  the world to play on (docs/world-format.md), relative to the repo root (default the generated
//              Earth, data/world-16384x8192); its base.json gives the size
//   TICK_MS    simulation step length in ms (default TICK_MS from shared; shorten for tests)
//   STEPS_PER_MONTH  simulation steps per game month (default STEPS_PER_MONTH from shared; tests use 1)
//   DEV_HOOKS  "1" enables dev-only hooks: the {t:'devIgnite',x,y} socket message starts a fire,
//              {t:'devFunds',amount} grants money, {t:'devReset'} wipes the server back to a fresh boot on an empty
//              save (only when it booted on one), {t:'devConfig',...} changes the settings below (see net.ts), and
//              random fire outbreaks are disabled so tests are deterministic. Never set in production.
//   SEASON_MONTH, ABANDON_DAY_MS, CITY_FREEZE_MS, SMALL_CITY_RELEASE_MS, REGROW_MS, REGROW_P, MONUMENT_MIN_POP,
//   DISASTER_EVERY_MS  settings for testing, see config.ts (the tests change them at runtime with devConfig)
//   ALL_ONLINE  "1": every mayor counts as online all the time (no frozen cities, disasters anywhere), to see how
//              a full world simulates. Test saves only: it keeps every city from going idle or being released.
//   DISASTER_TRIGGER  "1": players get a test dialog to start any disaster in any city right away (test servers).
//              Disasters never strike with DEV_HOOKS.
//   NOTIFY_DB  world reset notification sign-ups (SQLite; default notify.db beside the save directory, so it
//              survives the world reset)
//   WEATHER    "off": no real weather (clouds, rain and snow from NOAA GFS, fetched hourly; see weather.ts)

import os from 'node:os';
import path from 'node:path';
import { TICK_MS, DEFAULT_PORT, WORLD_W, WORLD_H, CHUNKS_X, CHUNKS_Y, STEPS_PER_MONTH, EARTH_W, EARTH_H, configureWorld } from '@globalcity/shared';
import { bootWorld } from './world.ts';
import { Players } from './players.ts';
import { Places } from './places.ts';
import { Persist } from './persist.ts';
import { Sim, type SimOptions } from './sim.ts';
import { Net } from './net.ts';
import { MapTiles } from './maptiles.ts';
import { Elevation } from './elevation.ts';
import fs from 'node:fs';
import { Notify } from './notify.ts';
import { Weather } from './weather.ts';
import { log, warn, timed } from './util.ts';
import { config, resetConfig } from './config.ts';

const TILE_FLUSH_MS = 100;
/** How often the zoomed-out map catches up with what was built. */
const MAP_REFRESH_MS = 10_000;

const root = path.resolve(import.meta.dirname, '../..');
const worldDir = path.resolve(root, process.env.WORLD_DIR || `data/world-${EARTH_W}x${EARTH_H}`);
/** The world's description (base.json): its size, and generatedAt, which identifies it. */
const worldInfo = ((): { w?: unknown; h?: unknown; generatedAt?: unknown } => {
  try {
    return JSON.parse(fs.readFileSync(path.join(worldDir, 'base.json'), 'utf8'));
  } catch {
    return {};
  }
})();
// before anything that depends on the world's size is built
configureWorld(typeof worldInfo.w === 'number' ? worldInfo.w : EARTH_W, typeof worldInfo.h === 'number' ? worldInfo.h : EARTH_H);
const baseFile = path.join(worldDir, 'base.bin');
const placesFile = path.join(worldDir, 'places.json');
const saveDir = path.resolve(root, process.env.DATA_DIR || 'data/save');
const clientDist = path.join(root, 'client/dist');
const port = Number(process.env.PORT) || DEFAULT_PORT;
const host = process.env.HOST || '0.0.0.0';
const tickMs = Number(process.env.TICK_MS) || TICK_MS;
const devHooks = process.env.DEV_HOOKS === '1';

const t0 = performance.now();
const world = bootWorld(baseFile);
const places = new Places();
places.load(placesFile);
let players = new Players(world, places);
let persist = new Persist(world, players, saveDir);
const hadState = persist.loadState();
const chunksLoaded = timed('Overlay saved chunks', () => persist.loadChunks());
log(
  `State: ${hadState ? `${players.players.size} players, ${players.claims.size} claims` : 'fresh'}; ${chunksLoaded} saved chunk(s); clock ${players.time.year}-${String(players.time.month + 1).padStart(2, '0')}`,
);

const worldId = worldInfo.generatedAt !== undefined ? String(worldInfo.generatedAt) : 'fallback';
const mapTiles = timed('Map tiles', () => new MapTiles(world, worldId));
// which disasters can strike where (a byte per chunk) and the elevation of every tile, from the world generator
const hazards = (() => {
  const f = path.join(worldDir, 'hazards.bin');
  if (!fs.existsSync(f)) {
    warn(`${f} not found: no natural disasters (regenerate the world)`);
    return undefined;
  }
  const h = new Uint8Array(fs.readFileSync(f));
  if (h.length !== CHUNKS_X * CHUNKS_Y) throw new Error(`${f} has ${h.length} bytes, expected ${CHUNKS_X * CHUNKS_Y} (a byte per chunk)`);
  return h;
})();
const elevation = new Elevation(path.join(worldDir, 'elevation.bin'));
// the real weather: fetched unless WEATHER=off (tests); test servers can still set one with devWeather
const weather = new Weather();
if (process.env.WEATHER !== 'off') weather.start();
const simOptions: SimOptions = { randomFires: !devHooks, hazards, elevation, weather };
let sim = new Sim(world, players, simOptions);
simOptions.shippingWater = sim.shipping.water;
const notify = new Notify(path.resolve(root, process.env.NOTIFY_DB || path.join(path.dirname(saveDir), 'notify.db')), devHooks);
const net = new Net(world, players, sim, clientDist, root, {
  devHooks,
  dataDir: saveDir,
  mapTiles,
  notify,
  weather,
  devReset: devHooks ? devReset : undefined,
});

/**
 * devReset (DEV_HOOKS only, for the tests): everything back to how this server booted on an empty save, keeping
 * the generated world in memory: built chunks restored, custom buildings gone, the save deleted, settings back to
 * the environment's, no notification sign-ups, and new players (so the clock starts over) and a new sim (no
 * fires, disasters, rail networks, ports or airports). Net resets its own part and closes every other socket.
 * Refused on a server that booted from a save, so a dev server's city can't be wiped by a stray message.
 */
function devReset(): { players: Players; sim: Sim } | string {
  if (hadState || chunksLoaded > 0) return 'this server booted from a save; devReset only resets servers that started on an empty one';
  persist.stop();
  const chunks = world.resetToBoot();
  persist.wipe();
  resetConfig();
  weather.override = null;
  notify.resetForTests();
  players = new Players(world, places);
  persist = new Persist(world, players, saveDir);
  sim = new Sim(world, players, simOptions);
  persist.start();
  log(`devReset: ${chunks} chunk(s) restored`);
  return { players, sim };
}
try {
  await net.listen(port, host);
} catch (e) {
  const err = e as NodeJS.ErrnoException;
  warn(err.code === 'EADDRINUSE' ? `Port ${port} is already in use (another server running? set PORT=...)` : `Could not listen on ${port}: ${err.message}`);
  process.exit(1);
}
persist.start();

/** Tick times, logged every TICK_LOG_EVERY ticks (average and slowest), so a long-running server shows its load. */
const TICK_LOG_EVERY = 60;
let tickSum = 0,
  tickMax = 0,
  tickN = 0;
const tickTimer = setInterval(() => {
  const t = performance.now();
  const result = sim.tick();
  net.afterTick(result);
  const dt = performance.now() - t;
  if (dt > tickMs / 2) warn(`Slow tick #${sim.tickCount}: ${dt.toFixed(0)} ms`);
  tickSum += dt;
  tickMax = Math.max(tickMax, dt);
  if (++tickN >= TICK_LOG_EVERY) {
    log(`Ticks: ${(tickSum / tickN).toFixed(1)} ms average, ${tickMax.toFixed(0)} ms slowest over the last ${tickN} (budget ${tickMs} ms)`);
    tickSum = tickMax = tickN = 0;
  }
}, tickMs);
const flushTimer = setInterval(() => net.flushTiles(), TILE_FLUSH_MS);
// oxlint-disable-next-line no-unused-vars -- never cleared in shutdown(), unlike the other timers (left as is in the oxc PR)
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
  World      ${WORLD_W} x ${WORLD_H} tiles, ${CHUNKS_X} x ${CHUNKS_Y} chunks (${worldDir.startsWith(root + path.sep) ? path.relative(root, worldDir) : worldDir})
  Listening  ${host}:${port}
  WebSocket  ws://localhost:${port}/ws
  HTTP       http://localhost:${port}/  (health: /health, /ATTRIBUTION.md)
${lanUrls()
  .map((u) => `  LAN        ${u}`)
  .join('\n')}
  Save dir   ${saveDir}
  Tick       every ${tickMs} ms = one simulation step (${Number(process.env.STEPS_PER_MONTH) || STEPS_PER_MONTH} to a game month)${devHooks ? '\n  DEV_HOOKS  enabled (devIgnite/devFunds accepted, random fires off)' : ''}${config.abandonDayMs !== 86_400_000 ? `\n  Day        ${config.abandonDayMs} ms (ABANDON_DAY_MS)` : ''}
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
