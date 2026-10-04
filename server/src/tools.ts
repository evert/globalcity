// Applying build tools (the 'build' client message). Rules are a simplified Micropolis tool.cpp.

import {
  TOOLS, type ToolId, type QueryInfo, WORLD_W, WORLD_H,
  LOMASK, ZONEBIT, ANIMBIT, BULLBIT, BURNBIT, CONDBIT, PWRBIT, BLBNBIT, BLBNCNBIT, BNCNBIT,
  DIRT, RUBBLE, WOODS2, FOUNTAIN, FIRE, LASTFIRE, FLOOD, LASTFLOOD, RADTILE, FIRSTRIVEDGE, LASTRIVEDGE,
  HBRIDGE, VBRIDGE, ROADBASE, ROADS, HROADPOWER, VROADPOWER, LTRFBASE, HTRFBASE, LASTROAD, POLICE_RANGE,
  HPOWER, VPOWER, LHPOWER, LVPOWER, LVPOWER10, RAILHPOWERV, RAILVPOWERH,
  HRAIL, VRAIL, LHRAIL, LVRAIL, LVRAIL10, HRAILROAD, VRAILROAD,
  FREEZ, COMCLR, INDCLR, HOSPITALBASE, CHURCHBASE, COMBASE, INDBASE, PORTBASE, LASTPORT, AIRPORTBASE, LASTAIRPORT,
  COALBASE, LASTPOWERPLANT, FIRESTBASE, POLICESTBASE, STADIUMBASE, FULLSTADIUMBASE, NUCLEARBASE, LASTZONE,
  ROAD_TABLE, RAIL_TABLE, WIRE_TABLE,
  BRIDGE_COST, UNDERWATER_WIRE_COST, UNDERWATER_RAIL_COST, AUTO_BULLDOZE_COST,
  footprintOrigin, chunkOf, inWorld,
  isDirt, isWater, isTree, isRubble, isRoad, isRail, isWire, isHouse, isResZone, isComZone, isIndZone, isPowered,
  roadPiece, trafficTile,
  isOverWater,
  RIVER,
  MILESTONE_BUILDINGS, isMilestoneTool, CITYHALLBASE, LASTCITYHALL,
  CHUNK,
} from '@globalcity/shared';
import type { World } from './world.ts';
import type { Players, PlayerRecord } from './players.ts';
import { unlockedOf } from './players.ts';
import { findZoneCenter, zonePop, zoneKind, isBuildingTile } from './zones.ts';
import { randInt } from './util.ts';

export interface BuildCtx {
  world: World;
  players: Players;
  /** number of cities on the rail network through tile (x,y), for the query tool (optional) */
  railCitiesAt?: (x: number, y: number) => number;
}
export type BuildResult =
  | { ok: true; cost: number; msg?: string }
  | { ok: false; msg: string; kind: 'error' | 'info' };

const fail = (msg: string, kind: 'error' | 'info' = 'error'): BuildResult => ({ ok: false, msg, kind });

// ---- neighbour classification for connection tables ----
const roadLike = (v: number): boolean => { const id = v & LOMASK; return isRoad(v) || id === HRAILROAD || id === VRAILROAD; };
const railLike = (v: number): boolean => isRail(v); // includes rail/road crossings and rail/wire crossings
/** Road piece 0..15 of a road tile at any traffic level (ROAD_PIECE_* below), or -1 for anything else. */
const pieceOf = (v: number): number => (isRoad(v) ? roadPiece(v & LOMASK) ?? -1 : -1);
const PIECE_HROADPOWER = HROADPOWER - ROADBASE, PIECE_VROADPOWER = VROADPOWER - ROADBASE;
const PIECE_ROADS = 2, PIECE_ROADS2 = 3, PIECE_INTERSECTION = 12;
/** Wires, underwater wires, rail/wire crossings and road/wire crossings at any traffic level. */
const wireLike = (v: number): boolean => { const p = pieceOf(v); return isWire(v) || p === PIECE_HROADPOWER || p === PIECE_VROADPOWER; };
/** Re-tablable road pieces: the 11 plain shapes ROADS..INTERSECTION, at any traffic level. */
const isPlainRoadPiece = (p: number): boolean => p >= PIECE_ROADS && p <= PIECE_INTERSECTION;
/** Traffic level 0/1/2 of a road tile id. */
export const trafficLevel = (id: number): 0 | 1 | 2 => (id < LTRFBASE ? 0 : id < HTRFBASE ? 1 : 2);
const isPlainRail = (id: number): boolean => id >= LHRAIL && id <= LVRAIL10;
const isPlainWire = (id: number): boolean => id >= LHPOWER && id <= LVPOWER10;
const isParkTile = (id: number): boolean => (id >= WOODS2 && id <= WOODS2 + 3) || id === FOUNTAIN;

function neighbourMask(world: World, x: number, y: number, pred: (v: number) => boolean): number {
  let m = 0;
  if (y > 0 && pred(world.get(x, y - 1))) m |= 1;
  if (inWorld(x + 1, y) && pred(world.get(x + 1, y))) m |= 2;
  if (inWorld(x, y + 1) && pred(world.get(x, y + 1))) m |= 4;
  if (x > 0 && pred(world.get(x - 1, y))) m |= 8;
  return m;
}

/** Re-table a plain road/rail/wire tile from its same-kind neighbours (Micropolis fixSingle). */
function fixTile(world: World, x: number, y: number): void {
  if (!inWorld(x, y)) return;
  const v = world.get(x, y);
  const id = v & LOMASK;
  const flags = v & ~LOMASK;
  const piece = pieceOf(v);
  // Traffic variants keep their level (and ANIMBIT, already in flags) while the shape follows the neighbours.
  if (isPlainRoadPiece(piece)) world.set(x, y, trafficTile(ROAD_TABLE[neighbourMask(world, x, y, roadLike)] - ROADBASE, trafficLevel(id)) | flags);
  else if (isPlainRail(id)) world.set(x, y, RAIL_TABLE[neighbourMask(world, x, y, railLike)] | flags);
  else if (isPlainWire(id)) world.set(x, y, WIRE_TABLE[neighbourMask(world, x, y, wireLike)] | flags);
}

/** Fix the tile and its 4 neighbours (Micropolis fixZone). */
export function fixZone(world: World, x: number, y: number): void {
  fixTile(world, x, y);
  fixTile(world, x, y - 1);
  fixTile(world, x + 1, y);
  fixTile(world, x, y + 1);
  fixTile(world, x - 1, y);
}

/** Extra cost to clear a tile for building, or -1 if the tile cannot be built on (incl. fire: wait for rubble). */
function clearCost(v: number): number {
  if (isDirt(v)) return 0;
  if (isTree(v) || isRubble(v)) return AUTO_BULLDOZE_COST;
  return -1;
}

/** Number of buildings in p's chunks whose centre tile id is `centre` (ZONEBIT set). */
function countCentres(world: World, p: PlayerRecord, centre: number): number {
  let n = 0;
  for (const key of p.chunks) {
    const [cx, cy] = key.split(',').map(Number);
    for (let dy = 0; dy < CHUNK; dy++) for (let dx = 0; dx < CHUNK; dx++) {
      const v = world.get(cx * CHUNK + dx, cy * CHUNK + dy);
      if ((v & ZONEBIT) && (v & LOMASK) === centre) n++;
    }
  }
  return n;
}

/** Horizontal if a same-kind neighbour is E/W, vertical if N/S, else horizontal. */
function orientation(world: World, x: number, y: number, pred: (v: number) => boolean): 'h' | 'v' {
  const m = neighbourMask(world, x, y, pred);
  if (m & (2 | 8)) return 'h';
  if (m & (1 | 4)) return 'v';
  return 'h';
}

export function applyBuild(ctx: BuildCtx, p: PlayerRecord, toolId: ToolId, x: number, y: number, opts: { ignoreMilestones?: boolean } = {}): BuildResult {
  const tool = TOOLS[toolId];
  if (!tool || toolId === 'query') return fail('Unknown tool');
  if (!Number.isInteger(x) || !Number.isInteger(y) || !inWorld(x, y)) return fail('Outside the world');
  const { world, players } = ctx;
  const { x0, y0 } = footprintOrigin(tool, x, y);
  // Every footprint tile must be in the world and in a chunk owned by this player.
  for (let dy = 0; dy < tool.size; dy++) {
    for (let dx = 0; dx < tool.size; dx++) {
      const tx = x0 + dx, ty = y0 + dy;
      if (!inWorld(tx, ty)) return fail('Outside the world');
      const c = chunkOf(tx, ty);
      if (!players.ownsChunk(p, c.cx, c.cy)) return fail('You can only build on land you have claimed');
    }
  }

  // Milestone buildings: unlocked by population (or grandfathered), and one per city.
  if (isMilestoneTool(toolId) && !opts.ignoreMilestones) {
    const m = MILESTONE_BUILDINGS[toolId];
    if (!unlockedOf(p).includes(toolId)) return fail(`The ${m.name.toLowerCase()} unlocks at ${m.pop.toLocaleString('en-US')} people`);
    if (countCentres(world, p, tool.base! + (tool.size === 6 ? 7 : 5)) > 0) return fail(`Your city already has a ${m.name.toLowerCase()} (one per city)`);
  }

  let result: BuildResult;
  switch (toolId) {
    case 'bulldozer': result = bulldoze(world, p, x, y); break;
    case 'road': result = layRoad(world, p, x, y); break;
    case 'rail': result = layRail(world, p, x, y); break;
    case 'wire': result = layWire(world, p, x, y); break;
    case 'park': result = layPark(world, p, x, y); break;
    default: result = placeZone(world, p, tool.base!, tool.size, tool.cost, x0, y0); break;
  }
  if (result.ok) {
    p.funds -= result.cost;
    p.stats.funds = p.funds;
    p.active = true;
    players.dirty = true;
  }
  return result;
}

function bulldoze(world: World, p: PlayerRecord, x: number, y: number): BuildResult {
  const v = world.get(x, y);
  const id = v & LOMASK;
  if (isBuildingTile(v)) {
    const z = findZoneCenter(world, x, y);
    if (!z) {
      // Orphan zone tile (should not happen): clear just this one.
      if (p.funds < 1) return fail('Not enough funds');
      world.set(x, y, (RUBBLE + randInt(3)) | BULLBIT);
      return { ok: true, cost: 1 };
    }
    const cost = z.size * z.size;
    if (p.funds < cost) return fail('Not enough funds');
    for (let dy = 0; dy < z.size; dy++) {
      for (let dx = 0; dx < z.size; dx++) {
        world.set(z.cx - 1 + dx, z.cy - 1 + dy, (RUBBLE + randInt(3)) | BULLBIT);
      }
    }
    return { ok: true, cost };
  }
  if (isDirt(v)) return fail('Nothing to bulldoze', 'info');
  if (id >= FIRE && id <= LASTFIRE) return fail("Can't bulldoze fire; wait for it to burn out", 'info');
  if (isWater(v)) {
    // Shoreline edges are bulldozable: landfill. Open water is not.
    if (id >= FIRSTRIVEDGE && id <= LASTRIVEDGE && (v & BULLBIT)) {
      if (p.funds < 1) return fail('Not enough funds');
      world.set(x, y, DIRT);
      return { ok: true, cost: 1 };
    }
    return fail("Can't bulldoze open water", 'info');
  }
  if (isOverWater(v)) {
    // Bridges and underwater lines revert to water: bulldozing them must never create land.
    if (p.funds < 1) return fail('Not enough funds');
    world.set(x, y, RIVER);
    fixZone(world, x, y);
    return { ok: true, cost: 1 };
  }
  const clearable = isRoad(v) || isRail(v) || isWire(v) || isTree(v) || isRubble(v) || isHouse(v) || isParkTile(id)
    || (id >= FLOOD && id <= LASTFLOOD) || id === RADTILE;
  if (!clearable) return fail("Can't bulldoze that", 'info');
  if (p.funds < 1) return fail('Not enough funds');
  world.set(x, y, DIRT);
  fixZone(world, x, y);
  return { ok: true, cost: 1 };
}

function layRoad(world: World, p: PlayerRecord, x: number, y: number): BuildResult {
  const v = world.get(x, y);
  const id = v & LOMASK;
  let tile: number;
  let cost: number;
  if (isWater(v)) {
    // Bridge: orientation follows adjacent roads (horizontal by default).
    tile = (orientation(world, x, y, roadLike) === 'h' ? HBRIDGE : VBRIDGE) | BULLBIT;
    cost = BRIDGE_COST;
  } else if (isPlainWire(id)) {
    if (id === LHPOWER) tile = VROADPOWER | CONDBIT | BLBNBIT; // vertical road over horizontal wire
    else if (id === LVPOWER) tile = HROADPOWER | CONDBIT | BLBNBIT;
    else return fail('Roads can only cross straight power lines');
    cost = TOOLS.road.cost;
  } else if (isPlainRail(id)) {
    if (id === LHRAIL) tile = HRAILROAD | BLBNBIT; // horizontal rail, vertical road
    else if (id === LVRAIL) tile = VRAILROAD | BLBNBIT;
    else return fail('Roads can only cross straight rail');
    cost = TOOLS.road.cost;
  } else if (isRoad(v) || id === HRAILROAD || id === VRAILROAD) {
    return fail('Already a road', 'info');
  } else {
    const extra = clearCost(v);
    if (extra < 0) return fail("Can't build a road here");
    tile = ROADS | BLBNBIT;
    cost = TOOLS.road.cost + extra;
  }
  if (p.funds < cost) return fail('Not enough funds');
  world.set(x, y, tile);
  fixZone(world, x, y);
  return { ok: true, cost };
}

function layRail(world: World, p: PlayerRecord, x: number, y: number): BuildResult {
  const v = world.get(x, y);
  const id = v & LOMASK;
  let tile: number;
  let cost: number;
  if (isWater(v)) {
    tile = (orientation(world, x, y, railLike) === 'h' ? HRAIL : VRAIL) | BULLBIT;
    cost = UNDERWATER_RAIL_COST;
  } else if (isPlainRoadPiece(pieceOf(v))) {
    const piece = pieceOf(v); // traffic variants cross like the plain road
    if (piece === PIECE_ROADS) tile = VRAILROAD | BLBNBIT; // vertical rail over horizontal road
    else if (piece === PIECE_ROADS2) tile = HRAILROAD | BLBNBIT;
    else return fail('Rail can only cross straight roads');
    cost = TOOLS.rail.cost;
  } else if (isPlainWire(id)) {
    if (id === LHPOWER) tile = RAILVPOWERH | CONDBIT | BLBNBIT;
    else if (id === LVPOWER) tile = RAILHPOWERV | CONDBIT | BLBNBIT;
    else return fail('Rail can only cross straight power lines');
    cost = TOOLS.rail.cost;
  } else if (isRail(v)) {
    return fail('Already rail', 'info');
  } else {
    const extra = clearCost(v);
    if (extra < 0) return fail("Can't build rail here");
    tile = LHRAIL | BLBNBIT;
    cost = TOOLS.rail.cost + extra;
  }
  if (p.funds < cost) return fail('Not enough funds');
  world.set(x, y, tile);
  fixZone(world, x, y);
  return { ok: true, cost };
}

function layWire(world: World, p: PlayerRecord, x: number, y: number): BuildResult {
  const v = world.get(x, y);
  const id = v & LOMASK;
  let tile: number;
  let cost: number;
  if (isWater(v)) {
    tile = (orientation(world, x, y, wireLike) === 'h' ? HPOWER : VPOWER) | CONDBIT | BULLBIT;
    cost = UNDERWATER_WIRE_COST;
  } else if (isPlainRoadPiece(pieceOf(v))) {
    const piece = pieceOf(v);
    if (piece === PIECE_ROADS) tile = HROADPOWER | CONDBIT | BLBNBIT;
    else if (piece === PIECE_ROADS2) tile = VROADPOWER | CONDBIT | BLBNBIT;
    else return fail('Power lines can only cross straight roads');
    cost = TOOLS.wire.cost;
  } else if (isPlainRail(id)) {
    if (id === LHRAIL) tile = RAILHPOWERV | CONDBIT | BLBNBIT;
    else if (id === LVRAIL) tile = RAILVPOWERH | CONDBIT | BLBNBIT;
    else return fail('Power lines can only cross straight rail');
    cost = TOOLS.wire.cost;
  } else if (wireLike(v)) {
    return fail('Already a power line', 'info');
  } else {
    const extra = clearCost(v);
    if (extra < 0) return fail("Can't build a power line here");
    tile = LHPOWER | CONDBIT | BLBNBIT;
    cost = TOOLS.wire.cost + extra;
  }
  if (p.funds < cost) return fail('Not enough funds');
  world.set(x, y, tile);
  fixZone(world, x, y);
  return { ok: true, cost };
}

function layPark(world: World, p: PlayerRecord, x: number, y: number): BuildResult {
  const v = world.get(x, y);
  if (!isDirt(v) && !isRubble(v)) return fail('Parks need clear land');
  const cost = TOOLS.park.cost;
  if (p.funds < cost) return fail('Not enough funds');
  // Micropolis: 1 in 4 parks is an animated fountain, the rest WOODS2..WOODS5.
  const tile = randInt(3) === 0 ? FOUNTAIN | BLBNBIT | ANIMBIT : (WOODS2 + randInt(3)) | BLBNBIT;
  world.set(x, y, tile);
  return { ok: true, cost };
}

/**
 * Zones (3x3) and buildings (4x4, 6x6): footprint must be dirt/tree/rubble or overland power line;
 * those are auto-bulldozed at AUTO_BULLDOZE_COST each. Zone tiles conduct, so a line running through
 * the footprint keeps carrying power across the zone.
 */
function placeZone(world: World, p: PlayerRecord, base: number, size: number, baseCost: number, x0: number, y0: number): BuildResult {
  let cost = baseCost;
  let clearedWire = false;
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const v = world.get(x0 + dx, y0 + dy);
      if (isPlainWire(v & LOMASK)) { cost += AUTO_BULLDOZE_COST; clearedWire = true; continue; }
      const extra = clearCost(v);
      if (extra < 0) return fail(isWater(v) ? "Can't build on water" : 'Area must be clear');
      cost += extra;
    }
  }
  if (p.funds < cost) return fail('Not enough funds');
  let t = base;
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      let v = t | BNCNBIT;
      if (dx === 1 && dy === 1) v |= ZONEBIT | BULLBIT;
      world.set(x0 + dx, y0 + dy, v);
      t++;
    }
  }
  if (clearedWire) {
    // power lines that ran into the footprint now end at the zone: re-table the pieces around it
    for (let i = -1; i <= size; i++) {
      fixTile(world, x0 + i, y0 - 1); fixTile(world, x0 + i, y0 + size);
      fixTile(world, x0 - 1, y0 + i); fixTile(world, x0 + size, y0 + i);
    }
  }
  if (base === PORTBASE && !waterNear(world, x0, y0, size, SEAPORT_WATER_RANGE)) {
    return { ok: true, cost, msg: 'Your seaport needs to be near water to attract industry' };
  }
  return { ok: true, cost };
}

/** Tiles from the footprint edge within which a seaport must find water to count (sim.ts uses the same rule). */
export const SEAPORT_WATER_RANGE = 6;

/** Any water tile within `range` tiles (Chebyshev) of the size x size footprint whose top-left is (x0,y0)? */
export function waterNear(world: World, x0: number, y0: number, size: number, range: number): boolean {
  for (let y = y0 - range; y < y0 + size + range; y++) {
    if (y < 0 || y >= WORLD_H) continue;
    for (let x = x0 - range; x < x0 + size + range; x++) {
      if (x >= 0 && x < WORLD_W && isWater(world.get(x, y))) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Query tool
// ---------------------------------------------------------------------------

export function queryTile(ctx: BuildCtx, x: number, y: number): QueryInfo {
  const { world, players } = ctx;
  const v = world.get(x, y);
  const id = v & LOMASK;
  let name: string;
  let zonePopN: number | undefined;
  let powered = isPowered(v);

  const zone = isBuildingTile(v) ? findZoneCenter(world, x, y) : null;
  if (zone) {
    const cv = world.get(zone.cx, zone.cy);
    powered = isPowered(cv);
    const kind = zoneKind(cv);
    if (kind === 'res' || kind === 'com' || kind === 'ind') {
      zonePopN = zonePop(world, zone.cx, zone.cy, cv);
      const cid = cv & LOMASK;
      const empty = cid === FREEZ || cid === COMCLR || cid === INDCLR;
      const label = kind === 'res' ? 'Residential' : kind === 'com' ? 'Commercial' : 'Industrial';
      name = `${label} zone${empty && kind !== 'res' ? ' (empty)' : ` (pop ${zonePopN})`}`;
    } else {
      name = buildingName(cv & LOMASK);
    }
  } else {
    name = terrainName(v);
    if (isRail(v) && ctx.railCitiesAt) {
      const n = ctx.railCitiesAt(x, y);
      if (n >= 2) name = `${name} (links ${n} cities)`;
    }
  }
  const c = chunkOf(x, y);
  const owner = players.ownerOf(c.cx, c.cy);
  const info: QueryInfo = { x, y, tile: v, name, powered };
  if (owner) info.owner = players.publicOf(owner);
  if (zonePopN !== undefined) info.zonePop = zonePopN;
  return info;
}

function buildingName(id: number): string {
  if (id >= HOSPITALBASE && id < CHURCHBASE) return 'Hospital';
  if (id >= CHURCHBASE && id < COMBASE) return 'Church';
  if (id >= PORTBASE && id <= LASTPORT) return 'Seaport';
  if (id >= CITYHALLBASE && id <= LASTCITYHALL) return 'City hall';
  if (id >= AIRPORTBASE && id <= LASTAIRPORT) return 'Airport';
  if (id >= COALBASE && id <= LASTPOWERPLANT) return 'Coal power plant';
  if (id >= FIRESTBASE && id < POLICESTBASE) return 'Fire station';
  if (id >= POLICESTBASE && id < STADIUMBASE) return `Police station (covers ${POLICE_RANGE} tiles)`;
  if (id >= STADIUMBASE && id < NUCLEARBASE) return id >= FULLSTADIUMBASE ? 'Stadium (game on!)' : 'Stadium';
  if (id >= NUCLEARBASE && id <= LASTZONE) return 'Nuclear power plant';
  if (isResZone(id)) return 'Residential zone';
  if (isComZone(id)) return 'Commercial zone';
  if (isIndZone(id)) return 'Industrial zone';
  return `Tile ${id}`;
}

function terrainName(v: number): string {
  const id = v & LOMASK;
  if (isDirt(v)) return 'Dirt';
  if (isWater(v)) return id >= FIRSTRIVEDGE && id <= LASTRIVEDGE ? 'Shoreline' : 'Water';
  if (isTree(v)) return 'Woods';
  if (id === FOUNTAIN) return 'Fountain';
  if (isParkTile(id)) return 'Park';
  if (isRubble(v)) return 'Rubble';
  if (id >= FLOOD && id <= LASTFLOOD) return 'Flood';
  if (id === RADTILE) return 'Radioactive waste';
  if (id >= FIRE && id <= LASTFIRE) return 'Fire';
  if (id === HBRIDGE || id === VBRIDGE) return 'Bridge';
  if (id === HROADPOWER || id === VROADPOWER) return 'Road with power line';
  if (id === HRAILROAD || id === VRAILROAD) return 'Rail crossing';
  if (id === RAILHPOWERV || id === RAILVPOWERH) return 'Rail with power line';
  if (id >= LTRFBASE && id <= LASTROAD) return id >= HTRFBASE ? 'Road (heavy traffic)' : 'Road (light traffic)';
  if (isRoad(v)) return 'Road';
  if (id === HPOWER || id === VPOWER) return 'Underwater power line';
  if (isWire(v)) return 'Power line';
  if (id === HRAIL || id === VRAIL) return 'Underwater rail';
  if (isRail(v)) return 'Rail';
  if (isHouse(v)) return 'House';
  return buildingName(id);
}
