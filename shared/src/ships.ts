// Shipping between seaports. The server publishes powered seaports and sea routes between pairs of
// different mayors' ports (polylines in tile coordinates, computed on a coarse water grid); every client
// derives the same voyages from that and the server clock, like flights.
import { WORLD_W } from './constants.ts';

export interface PortInfo { x: number; y: number; ownerId: string }
/** A sea route between ports a and b (indices into the port list): waypoints x0,y0,x1,y1,... from a to b. */
export interface SeaRoute { a: number; b: number; pts: number[] }

export interface Voyage {
  key: string;
  x: number; y: number; // current position in tiles
  vx: number; vy: number; // heading
  progress: number; // 0..1
  duration: number; // ms
  trail: number[]; // waypoints already passed + current position (for the world-map trail)
  from: PortInfo; to: PortInfo; // origin and destination ports
  depart: number; // ms (server clock)
}

/**
 * Each port launches a ship every shipPeriodS(ports) seconds. The interval grows with the square root of
 * the number of ports, so total traffic still rises (gently) as more ports join: 4 ports -> one sailing
 * each per 20 min, 16 ports -> each per 40 min (twice the world-wide traffic of 4 ports, not four times).
 * With ~40-minute voyages that keeps roughly 15 ships at sea for 16 ports.
 */
export const SHIP_PERIOD_BASE_S = 600;
export const shipPeriodS = (ports: number): number => SHIP_PERIOD_BASE_S * Math.sqrt(Math.max(1, ports));
/** Cruise speed in tiles per second: ships are slow, an ocean crossing takes the better part of an hour. */
export const SHIP_SPEED = 2;
export const SHIP_MIN_S = 20;

const keyOf = (p: PortInfo): string => `${p.x},${p.y}`;
function hash(str: string, n: number): number {
  let h = 2166136261 ^ n;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return h >>> 0;
}
const routeLength = (pts: number[]): number => {
  let len = 0;
  for (let i = 2; i < pts.length; i += 2) len += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
  return len;
};

/** All ships at sea at `now` (server clock ms). Routes are followed from a to b, or reversed. */
export function activeVoyages(ports: readonly PortInfo[], routes: readonly SeaRoute[], now: number): Voyage[] {
  if (ports.length < 2 || routes.length === 0) return [];
  // routes from each port (both directions), in a stable order
  const from = new Map<number, { to: number; pts: number[]; len: number }[]>();
  for (const r of routes) {
    const len = routeLength(r.pts);
    const rev: number[] = [];
    for (let i = r.pts.length - 2; i >= 0; i -= 2) rev.push(r.pts[i], r.pts[i + 1]);
    (from.get(r.a) ?? from.set(r.a, []).get(r.a)!).push({ to: r.b, pts: r.pts, len });
    (from.get(r.b) ?? from.set(r.b, []).get(r.b)!).push({ to: r.a, pts: rev, len });
  }
  const period = shipPeriodS(ports.length) * 1000;
  const longest = Math.max(...routes.map((r) => routeLength(r.pts))) / SHIP_SPEED * 1000 + 1000;
  const out: Voyage[] = [];
  ports.forEach((p, ai) => {
    const opts = (from.get(ai) ?? []).filter((o) => ports[o.to] && ports[o.to].ownerId !== p.ownerId).sort((u, v) => u.to - v.to);
    if (!opts.length) return;
    const phase = hash(keyOf(p), 0x5e) % period;
    const kMax = Math.floor((now - phase) / period), kMin = Math.floor((now - longest - phase) / period);
    for (let k = kMin; k <= kMax; k++) {
      const depart = k * period + phase;
      const o = opts[hash(keyOf(p), k) % opts.length];
      const duration = Math.max(SHIP_MIN_S * 1000, (o.len / SHIP_SPEED) * 1000);
      const t = (now - depart) / duration;
      if (t < 0 || t >= 1) continue;
      // walk the polyline to distance t * len
      let left = t * o.len, i = 2, x = o.pts[0], y = o.pts[1], vx = 1, vy = 0;
      const trail = [o.pts[0], o.pts[1]];
      for (; i < o.pts.length; i += 2) {
        const sx = o.pts[i] - o.pts[i - 2], sy = o.pts[i + 1] - o.pts[i - 1], seg = Math.hypot(sx, sy) || 1;
        vx = sx / seg; vy = sy / seg;
        if (left <= seg) { x = o.pts[i - 2] + vx * left; y = o.pts[i - 1] + vy * left; break; }
        left -= seg; trail.push(o.pts[i], o.pts[i + 1]); x = o.pts[i]; y = o.pts[i + 1];
      }
      trail.push(x, y);
      out.push({ key: `${keyOf(p)}>${keyOf(ports[o.to])}#${k}`, x: ((x % WORLD_W) + WORLD_W) % WORLD_W, y, vx, vy, progress: t, duration, trail, from: p, to: ports[o.to], depart });
    }
  });
  return out;
}
