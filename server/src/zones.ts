// Zone geometry helpers shared by the build tools and the simulation.
// Micropolis convention: a zone's hot-spot (ZONEBIT tile) is at offset (1,1) from the
// footprint's top-left for every size (3x3, 4x4, 6x6).

import {
  LOMASK,
  ZONEBIT,
  BULLBIT,
  PWRBIT,
  BNCNBIT,
  FREEZ,
  RZB,
  COMCLR,
  INDCLR,
  HOUSE,
  HHTHR,
  HOSPITALBASE,
  COMBASE,
  COMLAST,
  INDBASE,
  INDLAST,
  POWERPLANT,
  NUCLEAR,
  WINDFARM,
  OFFSHORE,
  resZonePop,
  comZonePop,
  indZonePop,
} from '@globalcity/shared';
import type { World } from './world.ts';

// zone geometry the build rules use too lives in shared/src/build.ts
export { isBuildingTile, findZoneCenter, clearFootprint } from '@globalcity/shared';

export type ZoneKind = 'res' | 'com' | 'ind' | 'coal' | 'nuclear' | 'wind' | 'offshore' | 'other';

export function zoneKind(centerTile: number): ZoneKind {
  const id = centerTile & LOMASK;
  if (id === FREEZ || (id >= RZB - 4 && id < HOSPITALBASE)) return 'res';
  if (id >= COMBASE && id <= COMLAST) return 'com';
  if (id >= INDBASE && id <= INDLAST) return 'ind';
  if (id === POWERPLANT) return 'coal';
  if (id === NUCLEAR) return 'nuclear';
  if (id === WINDFARM) return 'wind';
  if (id === OFFSHORE) return 'offshore';
  return 'other';
}

export const isPlantCenter = (v: number): boolean => {
  if ((v & ZONEBIT) === 0) return false;
  const id = v & LOMASK;
  return id === POWERPLANT || id === NUCLEAR || id === WINDFARM || id === OFFSHORE;
};

/** Houses (single-tile HOUSE..HHTHR) in the 8 tiles around an empty residential zone centre. */
export function countHouses(world: World, x: number, y: number): number {
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const id = world.get(x + dx, y + dy) & LOMASK;
      if (id >= HOUSE && id <= HHTHR) n++;
    }
  }
  return n;
}

/** Zone-unit population of the zone whose centre is at (x,y) (Micropolis getRes/Com/IndZonePop). */
export function zonePop(world: World, x: number, y: number, centerTile: number): number {
  const id = centerTile & LOMASK;
  switch (zoneKind(centerTile)) {
    case 'res':
      return id === FREEZ ? countHouses(world, x, y) : resZonePop(id);
    case 'com':
      return id === COMCLR ? 0 : comZonePop(id);
    case 'ind':
      return id === INDCLR ? 0 : indZonePop(id);
    default:
      return 0;
  }
}

/**
 * Lay a 3x3 zone footprint around centre (x,y): tiles base..base+8 row-major with BNCNBIT
 * (burnable + conductive), centre additionally ZONEBIT|BULLBIT (Micropolis zonePlop).
 * PWRBIT is carried over from the previous tiles so a growing zone does not flicker unpowered.
 */
export function plopZone(world: World, x: number, y: number, base: number): void {
  let t = base;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const old = world.get(x + dx, y + dy);
      let v = t | BNCNBIT | (old & PWRBIT);
      if (dx === 0 && dy === 0) v |= ZONEBIT | BULLBIT;
      world.set(x + dx, y + dy, v);
      t++;
    }
  }
}
