// Inter-city air traffic. The server publishes powered airports and its clock; flights are derived
// from that with the shared deterministic schedule, so every viewer sees the same planes.
import { activeFlights, FLIGHT_GROUND_S, type AirportInfo, type Flight } from '@globalcity/shared';

export class FlightLayer {
  airports: AirportInfo[] = [];
  /** server clock minus local clock, ms */
  private offset = 0;

  set(airports: AirportInfo[], serverNow: number): void {
    this.airports = Array.isArray(airports) ? airports.filter((a) => Number.isFinite(a.x) && Number.isFinite(a.y)) : [];
    if (Number.isFinite(serverNow)) this.offset = serverNow - Date.now();
  }

  /** At least two different mayors have powered airports, so planes fly between cities. */
  get interCity(): boolean { return new Set(this.airports.map((a) => a.ownerId)).size >= 2; }

  now(): number { return Date.now() + this.offset; }

  flights(): Flight[] { return activeFlights(this.airports, this.now()); }
}

/** Sprite frame for a flight: small take-off/landing frames near the ground, else the heading. */
export function flightFrame(f: Flight, dirFrame: (vx: number, vy: number) => number): number {
  const elapsed = f.progress * f.duration / 1000, left = (1 - f.progress) * f.duration / 1000;
  const edge = Math.min(elapsed, left);
  if (edge < FLIGHT_GROUND_S) return 8 + Math.min(2, Math.floor((FLIGHT_GROUND_S - edge) / (FLIGHT_GROUND_S / 3)));
  return dirFrame(f.vx, f.vy);
}

export function flightAlpha(f: Flight): number {
  const edge = Math.min(f.progress, 1 - f.progress) * f.duration / 1000;
  return Math.min(1, edge / 1.5);
}
