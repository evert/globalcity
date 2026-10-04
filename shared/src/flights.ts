// Air traffic between cities. The server publishes the list of powered airports (and its clock);
// every client derives the same flights from that list and the time, so all players see the same
// planes without any per-flight network traffic.
import { WORLD_W } from './constants.ts';

export interface AirportInfo {
  x: number; // airport centre tile
  y: number;
  ownerId: string;
}

export interface Flight {
  key: string; // stable id: `${from}>${to}#${k}`
  fromX: number; fromY: number;
  toX: number; toY: number; // destination, already unwrapped so the route is the shortest way round
  depart: number; // ms (server clock)
  duration: number; // ms
  progress: number; // 0..1
  x: number; y: number; // current position in tiles, wrapped into 0..WORLD_W
  vx: number; vy: number; // heading (unit-ish), for the direction frame
}

/**
 * Departures are budgeted for the whole world, not per airport: the world as a whole sees about one take-off
 * every FLIGHT_GLOBAL_INTERVAL_S, so each airport's interval grows with the number of airports and the sky
 * stays about equally busy (3-4 planes in the air) however many cities build one.
 */
export const FLIGHT_GLOBAL_INTERVAL_S = 60;
/** ...but a single airport never launches more often than this. */
export const FLIGHT_PERIOD_MIN_S = 120;
/** Interval between departures from one airport, given how many airports exist. */
export const flightPeriodS = (airports: number): number => Math.max(FLIGHT_PERIOD_MIN_S, FLIGHT_GLOBAL_INTERVAL_S * airports);
/** Cruise speed in tiles per second: about 7 s to cross the screen zoomed in. The Earth is 8192 tiles
 *  wide, so a long haul takes several minutes, like a real (if compressed) flight. */
export const FLIGHT_SPEED = 12;
export const FLIGHT_MIN_S = 12;
/** Seconds spent near the ground at each end (small sprite frames, fade). */
export const FLIGHT_GROUND_S = 3;

const keyOf = (a: AirportInfo): string => `${a.x},${a.y}`;

function hash(str: string, n: number): number {
  let h = 2166136261 ^ n;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return h >>> 0;
}

/** Destination for flight k from `a`: always an airport of a different mayor (null when there is none). */
export function destinationOf(a: AirportInfo, k: number, sortedOthers: AirportInfo[]): AirportInfo | null {
  const cands = sortedOthers.filter((b) => b.ownerId !== a.ownerId);
  if (cands.length === 0) return null;
  return cands[hash(keyOf(a), k) % cands.length];
}

/** Shortest horizontal delta on a world that wraps around the date line. */
export function wrapDx(dx: number): number {
  if (dx > WORLD_W / 2) return dx - WORLD_W;
  if (dx < -WORLD_W / 2) return dx + WORLD_W;
  return dx;
}

export function flightDuration(a: AirportInfo, b: AirportInfo): number {
  const d = Math.hypot(wrapDx(b.x - a.x), b.y - a.y);
  return Math.max(FLIGHT_MIN_S, d / FLIGHT_SPEED) * 1000;
}

/** All flights in the air at `now` (ms on the server clock). */
export function activeFlights(airports: readonly AirportInfo[], now: number): Flight[] {
  if (airports.length < 2) return [];
  const sorted = [...airports].sort((p, q) => (keyOf(p) < keyOf(q) ? -1 : 1));
  if (new Set(sorted.map((a) => a.ownerId)).size < 2) return [];
  const period = flightPeriodS(sorted.length) * 1000;
  const longest = (Math.max(FLIGHT_MIN_S, Math.hypot(WORLD_W / 2, WORLD_W / 4) / FLIGHT_SPEED) + 1) * 1000;
  const out: Flight[] = [];
  for (const a of sorted) {
    const phase = hash(keyOf(a), 0x7f) % period;
    const kMax = Math.floor((now - phase) / period);
    const kMin = Math.floor((now - longest - phase) / period);
    for (let k = kMin; k <= kMax; k++) {
      const depart = k * period + phase;
      const b = destinationOf(a, k, sorted);
      if (!b) break;
      const duration = flightDuration(a, b);
      const t = (now - depart) / duration;
      if (t < 0 || t >= 1) continue;
      const dx = wrapDx(b.x - a.x), dy = b.y - a.y;
      let x = a.x + dx * t;
      x = ((x % WORLD_W) + WORLD_W) % WORLD_W;
      const len = Math.hypot(dx, dy) || 1;
      out.push({
        key: `${keyOf(a)}>${keyOf(b)}#${k}`,
        fromX: a.x, fromY: a.y, toX: a.x + dx, toY: b.y,
        depart, duration, progress: t,
        x, y: a.y + dy * t, vx: dx / len, vy: dy / len,
      });
    }
  }
  return out;
}
