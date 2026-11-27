// Santa's sleigh. In December (the real calendar), once at least SANTA_MIN_TREES Christmas trees stand anywhere
// in the world, Santa makes trips: he flies in from the east, goes from tree to tree westward (the way midnight
// travels), stopping for a moment above each one, flies off past the last one and is gone for SANTA_REST_S before
// the next trip. The server publishes the trees (an empty list outside December or below the minimum) and its
// clock; every client derives the same sleigh from that, like the planes (flights.ts).
import { WORLD_W } from './constants.ts';

/** A stop: the top of a Christmas tree (tile coordinates). */
export interface SantaTree {
  x: number;
  y: number;
}

export const SANTA_MIN_TREES = 4;
/** Cruise speed between nearby trees, tiles per second (a bit faster than a plane: it's Santa). */
export const SANTA_SPEED = 20;
/** ...but no hop takes longer than this, however far the next tree is (oceans go by quickly). */
export const SANTA_MAX_HOP_S = 45;
export const SANTA_MIN_HOP_S = 3;
/** Seconds hovering above each tree (dropping off presents). */
export const SANTA_STOP_S = 4;
/** Flying in before the first tree and off after the last: this far (tiles) and this long, fading in and out. */
export const SANTA_ARRIVE_TILES = 60;
export const SANTA_ARRIVE_S = 5;
/** Gone this long between trips. */
export const SANTA_REST_S = 15 * 60;
/** The sleigh sprite (client/public/assets/vehicles/sleigh.png): px size, drawn this many tiles wide, facing
 *  west; the lead reindeer's nose glows at night (art/prototype/seasonal/sleigh.py prints its position). */
export const SLEIGH_PX = { w: 64, h: 32 };
export const SLEIGH_TILES = 4;
export const SLEIGH_NOSE = { x: 4, y: 15 };

/** One piece of a trip: hovering at (x, y), or flying (dx, dy) from it; `fade` on the way in or out. */
interface Leg {
  x: number;
  y: number;
  dx: number;
  dy: number;
  start: number;
  dur: number;
  stop: boolean;
  fade?: 'in' | 'out';
}
export interface SantaRoute {
  stops: SantaTree[];
  legs: Leg[];
  trip: number;
  period: number;
}

export interface Sleigh {
  x: number;
  y: number; // tiles, x wrapped into 0..WORLD_W
  vx: number;
  vy: number; // heading (unit); vx <= 0, always westward
  stopped: boolean; // hovering above a tree
  alpha: number; // 0..1, fading in on arrival and out on leaving
}

/** Santa's trip: trees east to west, each hop westward. Null (no Santa) below SANTA_MIN_TREES. */
export function santaRoute(trees: readonly SantaTree[]): SantaRoute | null {
  if (trees.length < SANTA_MIN_TREES) return null;
  const stops = [...trees].sort((a, b) => b.x - a.x || a.y - b.y);
  const legs: Leg[] = [];
  let t = 0;
  const fly = (x: number, y: number, dx: number, dy: number, dur: number, fade?: 'in' | 'out') => {
    legs.push({ x, y, dx, dy, start: t, dur, stop: false, fade });
    t += dur;
  };
  const arrive = SANTA_ARRIVE_S * 1000,
    a = SANTA_ARRIVE_TILES;
  fly(stops[0].x + a, stops[0].y - a / 3, -a, a / 3, arrive, 'in');
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    legs.push({ x: s.x, y: s.y, dx: 0, dy: 0, start: t, dur: SANTA_STOP_S * 1000, stop: true });
    t += SANTA_STOP_S * 1000;
    if (i === stops.length - 1) break;
    const n = stops[i + 1],
      dx = n.x - s.x,
      dy = n.y - s.y; // n.x <= s.x: westward
    fly(s.x, s.y, dx, dy, Math.min(SANTA_MAX_HOP_S, Math.max(SANTA_MIN_HOP_S, Math.hypot(dx, dy) / SANTA_SPEED)) * 1000);
  }
  const last = stops[stops.length - 1];
  fly(last.x, last.y, -a, -a / 3, arrive, 'out');
  return { stops, legs, trip: t, period: t + SANTA_REST_S * 1000 };
}

const wrapX = (x: number): number => ((x % WORLD_W) + WORLD_W) % WORLD_W;

/** Where the sleigh is at `now` (ms, server clock), or null while Santa is away between trips. */
export function sleighAt(route: SantaRoute, now: number): Sleigh | null {
  const t = ((now % route.period) + route.period) % route.period;
  if (t >= route.trip) return null;
  let lo = 0,
    hi = route.legs.length - 1; // last leg that started at or before t
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (route.legs[mid].start <= t) lo = mid;
    else hi = mid - 1;
  }
  const l = route.legs[lo],
    p = (t - l.start) / l.dur;
  if (l.stop) {
    // hovering: a gentle bob above the tree, facing on to the next one
    const next = route.legs[lo + 1],
      len = Math.hypot(next.dx, next.dy) || 1;
    return { x: wrapX(l.x), y: l.y + Math.sin(p * Math.PI * 2) * 0.3, vx: next.dx / len, vy: next.dy / len, stopped: true, alpha: 1 };
  }
  const len = Math.hypot(l.dx, l.dy) || 1;
  const e = l.fade === 'in' ? 1 - (1 - p) * (1 - p) : l.fade === 'out' ? p * p : p * p * (3 - 2 * p); // ease into and out of the stops
  const alpha = l.fade === 'in' ? p : l.fade === 'out' ? 1 - p : 1;
  return { x: wrapX(l.x + l.dx * e), y: l.y + l.dy * e, vx: l.dx / len, vy: l.dy / len, stopped: false, alpha };
}
