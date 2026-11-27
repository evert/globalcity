// The real sun over the game's Earth. The world map is equirectangular (tile x -> longitude, y -> latitude),
// so day and night follow the actual time: night falls on each city when it is night there. Cosmetic only;
// the simulation does not depend on it. Accuracy (about a degree, a few minutes of time) is plenty for shading.
import { WORLD_W, WORLD_H } from './constants.ts';

const RAD = Math.PI / 180;

/** Latitude/longitude (degrees) where the sun is straight overhead at time `ms` (Unix ms). */
export function subsolarPoint(ms: number): { lat: number; lon: number } {
  const d = ms / 86_400_000 + 2440587.5 - 2451545.0; // days since J2000.0
  const g = (357.529 + 0.98560028 * d) * RAD; // mean anomaly
  const q = 280.459 + 0.98564736 * d; // mean longitude
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD; // ecliptic longitude
  const e = (23.439 - 0.00000036 * d) * RAD; // obliquity
  const decl = Math.asin(Math.sin(e) * Math.sin(L));
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / RAD;
  const gmst = 280.46061837 + 360.98564736629 * d; // Greenwich sidereal time, degrees
  const lon = ((((ra - gmst) % 360) + 540) % 360) - 180;
  return { lat: decl / RAD, lon };
}

/** Sun elevation (degrees above the horizon) at a place, given the subsolar point. */
export function sunElevation(lat: number, lon: number, sub: { lat: number; lon: number }): number {
  const s = Math.sin(lat * RAD) * Math.sin(sub.lat * RAD) + Math.cos(lat * RAD) * Math.cos(sub.lat * RAD) * Math.cos((lon - sub.lon) * RAD);
  return Math.asin(Math.max(-1, Math.min(1, s))) / RAD;
}

/** How dark it is, 0 (day) .. 1 (night): fades in from sunset (+2 deg) to the end of civil twilight (-10 deg). */
export function nightLevel(elevation: number): number {
  const t = Math.max(0, Math.min(1, (2 - elevation) / 12));
  return t * t * (3 - 2 * t); // smoothstep
}

/** Night level at tile (x, y) at time `ms`. */
export function nightAtTile(x: number, y: number, ms: number, sub = subsolarPoint(ms)): number {
  const lon = (x / WORLD_W) * 360 - 180,
    lat = 90 - (y / WORLD_H) * 180;
  return nightLevel(sunElevation(lat, lon, sub));
}
