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
  RADAR0,
  RADAR7,
  SMOKEBASE,
  FOOTBALLGAME2,
  NUKESWIRL1,
  NUKESWIRL4,
  zoneSizeForCenter,
  resZonePop,
  comZonePop,
  indZonePop,
  inWorld,
  isZoneTile,
  isCustomTile,
  CUSTOM_BUILDINGS,
} from '@globalcity/shared';
import type { World } from './world.ts';

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

/**
 * True for any tile that belongs to a multi-tile zone/building: the plain footprint ids (isZoneTile) plus the
 * animated cells the simulator swaps in (airport radar 832..839, industrial smoke 852..859 and 884..915,
 * coal smoke 916..931, stadium game 932..947, nuclear swirl 952..955). Use this, not isZoneTile, wherever a
 * hit on one tile must find the whole building (bulldozer, fire, query).
 */
export const isBuildingTile = (v: number): boolean => {
  if (isZoneTile(v)) return true;
  const t = v & LOMASK;
  return (
    (t >= RADAR0 && t <= RADAR7) ||
    (t >= SMOKEBASE && t <= SMOKEBASE + 7) ||
    (t >= SMOKEBASE + 32 && t <= FOOTBALLGAME2 + 7) ||
    (t >= NUKESWIRL1 && t <= NUKESWIRL4)
  );
};

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
 * Find the centre of the multi-tile zone/building covering tile (x,y).
 * Centres lie within [x-4, x+1] x [y-4, y+1] for footprints up to 6x6 with the (1,1) hot-spot.
 */
/**
 * The building covering (x,y): its hot-spot tile (cx, cy) at footprint offset (1,1), width and height
 * (size = the larger side, for square-only callers). Custom-layer buildings come from the registry.
 */
export function findZoneCenter(world: World, x: number, y: number): { cx: number; cy: number; size: number; w: number; h: number } | null {
  if (isCustomTile(world.get(x, y))) {
    const b = world.buildings.at(x, y);
    return b ? { cx: b.x + 1, cy: b.y + 1, size: Math.max(b.w, b.h), w: b.w, h: b.h } : null;
  }
  for (let cy = y - 4; cy <= y + 1; cy++) {
    for (let cx = x - 4; cx <= x + 1; cx++) {
      if (!inWorld(cx, cy)) continue;
      const v = world.get(cx, cy);
      if ((v & ZONEBIT) === 0) continue;
      const size = zoneSizeForCenter(v);
      if (size === 0) continue;
      const ox = cx - 1,
        oy = cy - 1;
      if (x >= ox && x < ox + size && y >= oy && y < oy + size) return { cx, cy, size, w: size, h: size };
    }
  }
  return null;
}

/** Clear a building's footprint to `tile(dx,dy)`, dropping it from the custom layer if it is one. */
export function clearFootprint(world: World, z: { cx: number; cy: number; w: number; h: number }, tile: (dx: number, dy: number) => number): void {
  const b = isCustomTile(world.get(z.cx, z.cy)) ? world.buildings.at(z.cx, z.cy) : undefined;
  const keepRow = b ? CUSTOM_BUILDINGS[b.kind]?.railRow : undefined; // a station's track outlives the station
  for (let dy = 0; dy < z.h; dy++)
    for (let dx = 0; dx < z.w; dx++) {
      if (dy === keepRow) continue;
      world.set(z.cx - 1 + dx, z.cy - 1 + dy, tile(dx, dy));
    }
  if (b) world.buildings.remove(b);
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
