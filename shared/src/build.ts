// The build rules (the 'build' client message): what a tool does to the tiles. A simplified Micropolis tool.cpp.
// Pure tile logic behind small interfaces, so the server applies it to the world and the client can run the
// same rules on its copy of the map to show a build straight away (a prediction the server then confirms).

import {
  LOMASK,
  ZONEBIT,
  ANIMBIT,
  BULLBIT,
  CONDBIT,
  BLBNBIT,
  BNCNBIT,
  DIRT,
  RUBBLE,
  WOODS2,
  FOUNTAIN,
  FIRE,
  LASTFIRE,
  FLOOD,
  LASTFLOOD,
  RADTILE,
  FIRSTRIVEDGE,
  LASTRIVEDGE,
  HBRIDGE,
  VBRIDGE,
  ROADBASE,
  ROADS,
  HROADPOWER,
  VROADPOWER,
  LTRFBASE,
  HTRFBASE,
  HPOWER,
  VPOWER,
  UWPOWER_NE,
  UWPOWER_SE,
  UWPOWER_SW,
  UWPOWER_NW,
  isUnderwaterWireId,
  LHPOWER,
  LVPOWER,
  LVPOWER10,
  RAILHPOWERV,
  RAILVPOWERH,
  HRAIL,
  VRAIL,
  LHRAIL,
  LVRAIL,
  LVRAIL10,
  HRAILROAD,
  VRAILROAD,
  PORTBASE,
  RADAR0,
  RADAR7,
  SMOKEBASE,
  FOOTBALLGAME2,
  NUKESWIRL1,
  NUKESWIRL4,
  ROAD_TABLE,
  RAIL_TABLE,
  WIRE_TABLE,
  isDirt,
  isWater,
  isTree,
  isRubble,
  isRoad,
  isRail,
  isWire,
  isHouse,
  isOverWater,
  RIVER,
  CUSTOMCENTRE,
  CUSTOMFILL,
  isCustomTile,
  isOffshoreTile,
  isZoneTile,
  zoneSizeForCenter,
} from './tiles.ts';
import { WORLD_W, WORLD_H, CHUNK } from './constants.ts';
import { chunkOf, inWorld } from './geo.ts';
import { roadPiece, trafficTile } from './animation.ts';
import {
  TOOLS,
  type ToolId,
  BRIDGE_COST,
  UNDERWATER_WIRE_COST,
  UNDERWATER_RAIL_COST,
  AUTO_BULLDOZE_COST,
  footprintOrigin,
  toolW,
  toolH,
  MILESTONE_BUILDINGS,
  isMilestoneTool,
  milestoneLower,
  CUSTOM_BUILDINGS,
  GRAND_CENTRAL,
} from './tools.ts';

// ---- what the rules need ----

/** A custom-layer building as the registry holds it. */
export interface BuildBuilding {
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The tiles the rules read and write. */
export interface BuildWorld {
  /** tile value at (x,y) (in the world; looks above bit 16 are ignored) */
  get(x: number, y: number): number;
  set(x: number, y: number, v: number): void;
  /** is the water at (x,y) frozen (from the landscape; it never changes) */
  frozen(x: number, y: number): boolean;
  /** the custom-building layer */
  readonly buildings: {
    at(x: number, y: number): BuildBuilding | undefined;
    add(kind: string, x: number, y: number): unknown;
    remove(b: BuildBuilding): void;
  };
}

/** The player building, as far as the rules care. */
export interface BuildPlayer {
  readonly funds: number;
  ownsChunk(cx: number, cy: number): boolean;
  /** milestone buildings this player may build */
  unlocked(): readonly string[];
  /** can this (seasonal) tool be built now */
  inSeason(tool: ToolId): boolean;
  /** has their rail reached another mayor's city (unlocks Grand Central) */
  readonly railLinked: boolean;
  /** how many of milestone building `b` stand in their plots */
  countMilestone(b: string): number;
  /** how many custom-layer buildings of `kind` stand in their plots */
  countCustom(kind: string): number;
}

/** Random integer 0..n inclusive (rubble variants, fountains). */
export type BuildRng = (n: number) => number;
export const mathRandInt: BuildRng = (n) => Math.floor(Math.random() * (n + 1));

export type BuildResult = { ok: true; cost: number; msg?: string } | { ok: false; msg: string; kind: 'error' | 'info' };

const fail = (msg: string, kind: 'error' | 'info' = 'error'): BuildResult => ({ ok: false, msg, kind });

// ---- zone geometry ----
// Micropolis convention: a zone's hot-spot (ZONEBIT tile) is at offset (1,1) from the footprint's top-left for
// every size (3x3, 4x4, 6x6).

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

/**
 * The building covering (x,y): its hot-spot tile (cx, cy) at footprint offset (1,1), width and height
 * (size = the larger side, for square-only callers). Custom-layer buildings come from the registry.
 * Centres lie within [x-4, x+1] x [y-4, y+1] for footprints up to 6x6 with the (1,1) hot-spot.
 */
export function findZoneCenter(
  world: Pick<BuildWorld, 'get' | 'buildings'>,
  x: number,
  y: number,
): { cx: number; cy: number; size: number; w: number; h: number } | null {
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
export function clearFootprint(
  world: Pick<BuildWorld, 'get' | 'set' | 'buildings'>,
  z: { cx: number; cy: number; w: number; h: number },
  tile: (dx: number, dy: number) => number,
): void {
  const b = isCustomTile(world.get(z.cx, z.cy)) ? world.buildings.at(z.cx, z.cy) : undefined;
  const keepRow = b ? CUSTOM_BUILDINGS[b.kind]?.railRow : undefined; // a station's track outlives the station
  for (let dy = 0; dy < z.h; dy++)
    for (let dx = 0; dx < z.w; dx++) {
      if (dy === keepRow) continue;
      world.set(z.cx - 1 + dx, z.cy - 1 + dy, tile(dx, dy));
    }
  if (b) world.buildings.remove(b);
}

// ---- neighbour classification for connection tables ----
const roadLike = (v: number): boolean => {
  const id = v & LOMASK;
  return isRoad(v) || id === HRAILROAD || id === VRAILROAD;
};
const railLike = (v: number): boolean => isRail(v); // includes rail/road crossings and rail/wire crossings
/** Road piece 0..15 of a road tile at any traffic level (ROAD_PIECE_* below), or -1 for anything else. */
const pieceOf = (v: number): number => (isRoad(v) ? (roadPiece(v & LOMASK) ?? -1) : -1);
const PIECE_HROADPOWER = HROADPOWER - ROADBASE,
  PIECE_VROADPOWER = VROADPOWER - ROADBASE;
const PIECE_ROADS = 2,
  PIECE_ROADS2 = 3,
  PIECE_INTERSECTION = 12;
/** Wires, underwater wires, rail/wire crossings and road/wire crossings at any traffic level. */
const wireLike = (v: number): boolean => {
  const p = pieceOf(v);
  return isWire(v) || p === PIECE_HROADPOWER || p === PIECE_VROADPOWER;
};
/** Re-tablable road pieces: the 11 plain shapes ROADS..INTERSECTION, at any traffic level. */
const isPlainRoadPiece = (p: number): boolean => p >= PIECE_ROADS && p <= PIECE_INTERSECTION;
/** Traffic level 0/1/2 of a road tile id. */
export const trafficLevel = (id: number): 0 | 1 | 2 => (id < LTRFBASE ? 0 : id < HTRFBASE ? 1 : 2);
const isPlainRail = (id: number): boolean => id >= LHRAIL && id <= LVRAIL10;
const isPlainWire = (id: number): boolean => id >= LHPOWER && id <= LVPOWER10;
export const isParkTile = (id: number): boolean => (id >= WOODS2 && id <= WOODS2 + 3) || id === FOUNTAIN;

function neighbourMask(world: BuildWorld, x: number, y: number, pred: (v: number) => boolean): number {
  let m = 0;
  if (y > 0 && pred(world.get(x, y - 1))) m |= 1;
  if (inWorld(x + 1, y) && pred(world.get(x + 1, y))) m |= 2;
  if (inWorld(x, y + 1) && pred(world.get(x, y + 1))) m |= 4;
  if (x > 0 && pred(world.get(x - 1, y))) m |= 8;
  return m;
}

/** Re-table a plain road/rail/wire tile from its same-kind neighbours (Micropolis fixSingle). */
export function fixTile(world: BuildWorld, x: number, y: number): void {
  if (!inWorld(x, y)) return;
  const v = world.get(x, y);
  const id = v & LOMASK;
  const flags = v & ~LOMASK;
  const piece = pieceOf(v);
  // Traffic variants keep their level (and ANIMBIT, already in flags) while the shape follows the neighbours.
  if (isPlainRoadPiece(piece)) world.set(x, y, trafficTile(ROAD_TABLE[neighbourMask(world, x, y, roadLike)] - ROADBASE, trafficLevel(id)) | flags);
  else if (isPlainRail(id)) world.set(x, y, RAIL_TABLE[neighbourMask(world, x, y, railLike)] | flags);
  else if (isPlainWire(id)) world.set(x, y, WIRE_TABLE[neighbourMask(world, x, y, wireLike)] | flags);
  else if (isUnderwaterWireId(id)) {
    const uw = underwaterWire(neighbourMask(world, x, y, wireLike), id);
    if (uw !== id) world.set(x, y, uw | flags);
  }
}

/**
 * Underwater power line piece for a neighbour mask (N=1 E=2 S=4 W=8): a corner when it links exactly one
 * N/S and one E/W neighbour, otherwise a straight run that keeps its axis where it can; unchanged when alone.
 * Micropolis' names are misleading: 208 (HPOWER) draws the cable north-south and 209 (VPOWER) east-west.
 */
function underwaterWire(m: number, current: number): number {
  switch (m) {
    case 1 | 2:
      return UWPOWER_NE;
    case 4 | 2:
      return UWPOWER_SE;
    case 4 | 8:
      return UWPOWER_SW;
    case 1 | 8:
      return UWPOWER_NW;
  }
  const ns = (m & 5) === 5,
    ew = (m & 10) === 10;
  if (ns && !ew) return HPOWER;
  if (ew && !ns) return VPOWER;
  // ambiguous (a T or cross, or a lone link): keep a straight that still links along its own axis
  if (current === HPOWER && m & 5) return HPOWER;
  if (current === VPOWER && m & 10) return VPOWER;
  if (m & 10) return VPOWER;
  if (m & 5) return HPOWER;
  return current;
}

/** Fix the tile and its 4 neighbours (Micropolis fixZone). */
export function fixZone(world: BuildWorld, x: number, y: number): void {
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

// ---- counting a city's buildings ----

/** How many custom-layer buildings of `kind` stand in the plots `chunks` ("cx,cy" keys). */
export function countCustomIn(world: Pick<BuildWorld, 'get' | 'buildings'>, chunks: Iterable<string>, kind: string): number {
  let n = 0;
  for (const key of chunks) {
    const [cx, cy] = key.split(',').map(Number);
    for (let dy = 0; dy < CHUNK; dy++)
      for (let dx = 0; dx < CHUNK; dx++) {
        const x = cx * CHUNK + dx,
          y = cy * CHUNK + dy,
          v = world.get(x, y);
        if (v & ZONEBIT && (v & LOMASK) === CUSTOMCENTRE && world.buildings.at(x, y)?.kind === kind) n++;
      }
  }
  return n;
}

/** How many of milestone building `b` stand in the plots `chunks` (tile buildings by centre id, custom ones by kind). */
export function countMilestoneIn(world: Pick<BuildWorld, 'get' | 'buildings'>, chunks: Iterable<string>, b: string): number {
  const m = MILESTONE_BUILDINGS[b as keyof typeof MILESTONE_BUILDINGS];
  if (m.centres.length) return countCentres(world, chunks, m.centres);
  return countCustomIn(world, chunks, b);
}

/** Number of buildings in the plots whose centre tile id is one of `centres` (ZONEBIT set). */
function countCentres(world: Pick<BuildWorld, 'get'>, chunks: Iterable<string>, centres: number[]): number {
  let n = 0;
  for (const key of chunks) {
    const [cx, cy] = key.split(',').map(Number);
    for (let dy = 0; dy < CHUNK; dy++)
      for (let dx = 0; dx < CHUNK; dx++) {
        const v = world.get(cx * CHUNK + dx, cy * CHUNK + dy);
        if (v & ZONEBIT && centres.includes(v & LOMASK)) n++;
      }
  }
  return n;
}

/** Horizontal if a same-kind neighbour is E/W, vertical if N/S, else horizontal. */
function orientation(world: BuildWorld, x: number, y: number, pred: (v: number) => boolean): 'h' | 'v' {
  const m = neighbourMask(world, x, y, pred);
  if (m & (2 | 8)) return 'h';
  if (m & (1 | 4)) return 'v';
  return 'h';
}

// ---- the rules ----

/**
 * Apply tool `toolId` at (x,y) for player `p`: checks, then the tile changes. On success the result carries the
 * cost; spending it is up to the caller.
 */
export function applyBuildRules(
  world: BuildWorld,
  p: BuildPlayer,
  toolId: ToolId,
  x: number,
  y: number,
  opts: { ignoreMilestones?: boolean } = {},
  rng: BuildRng = mathRandInt,
): BuildResult {
  const tool = TOOLS[toolId];
  if (!tool || toolId === 'query') return fail('Unknown tool');
  if (!Number.isInteger(x) || !Number.isInteger(y) || !inWorld(x, y)) return fail('Outside the world');
  const { x0, y0 } = footprintOrigin(tool, x, y);
  // Every footprint tile must be in the world and in a chunk owned by this player.
  for (let dy = 0; dy < toolH(tool); dy++) {
    for (let dx = 0; dx < toolW(tool); dx++) {
      const tx = x0 + dx,
        ty = y0 + dy;
      if (!inWorld(tx, ty)) return fail('Outside the world');
      const c = chunkOf(tx, ty);
      if (!p.ownsChunk(c.cx, c.cy)) return fail('You can only build on land you have claimed');
    }
  }

  // Milestone buildings: unlocked by population (or grandfathered); some have a per-city limit.
  if (isMilestoneTool(toolId) && !opts.ignoreMilestones) {
    const m = MILESTONE_BUILDINGS[toolId];
    if (!p.unlocked().includes(toolId)) return fail(`The ${milestoneLower(m)} unlocks at ${m.pop.toLocaleString('en-US')} people`);
    if (!p.inSeason(toolId)) return fail(`The ${milestoneLower(m)} can only be built in ${m.seasonName}`, 'info');
    if (m.max !== undefined && p.countMilestone(toolId) >= m.max) return fail(`Your city already has a ${milestoneLower(m)} (one per city)`);
  }

  // Grand Central: unlocked by the first rail link to another mayor's city; one per city.
  if (toolId === 'grandcentral' && !opts.ignoreMilestones) {
    if (!p.railLinked) return fail(`Grand Central unlocks when you ${GRAND_CENTRAL.unlock.toLowerCase()}`);
    if (p.countCustom('grandcentral') >= 1) return fail('Your city already has a Grand Central (one per city)');
  }
  // Tiles inside a custom building (e.g. Grand Central's track) only change through the building itself.
  if ((toolId === 'road' || toolId === 'rail' || toolId === 'wire' || toolId === 'park') && world.buildings.at(x, y)) {
    return fail(`That is part of the ${(CUSTOM_BUILDINGS[world.buildings.at(x, y)!.kind]?.name ?? 'building').toLowerCase()}`, 'info');
  }

  switch (toolId) {
    case 'bulldozer':
      return bulldoze(world, p, x, y, rng);
    case 'road':
      return layRoad(world, p, x, y);
    case 'rail':
      return layRail(world, p, x, y);
    case 'wire':
      return layWire(world, p, x, y);
    case 'park':
      return layPark(world, p, x, y, rng);
    case 'offshore':
      return placeOffshore(world, p, tool.base!, tool.size, tool.cost, x0, y0);
    case 'university':
      return placeCustom(world, p, tool.custom!, tool.cost, x0, y0);
    case 'grandcentral':
      return placeCustom(world, p, tool.custom!, tool.cost, x0, y0);
    case 'christmastree':
      return placeCustom(world, p, tool.custom!, tool.cost, x0, y0);
    default:
      return placeZone(world, p, tool.base!, tool.size, tool.cost, x0, y0);
  }
}

function bulldoze(world: BuildWorld, p: BuildPlayer, x: number, y: number, rng: BuildRng): BuildResult {
  const v = world.get(x, y);
  const id = v & LOMASK;
  const inside = world.buildings.at(x, y);
  if (inside && !isCustomTile(v)) {
    // a building's rail row: the track belongs to the building and is kept when the building goes
    return fail(`The track runs through ${CUSTOM_BUILDINGS[inside.kind]?.name ?? 'the building'}: bulldoze the building to remove it`, 'info');
  }
  if (isBuildingTile(v)) {
    const z = findZoneCenter(world, x, y);
    if (!z) {
      // Orphan zone tile (should not happen): clear just this one.
      if (p.funds < 1) return fail('Not enough funds');
      world.set(x, y, (RUBBLE + rng(3)) | BULLBIT);
      return { ok: true, cost: 1 };
    }
    const cost = z.w * z.h;
    if (p.funds < cost) return fail('Not enough funds');
    const offshore = isOffshoreTile(world.get(z.cx, z.cy));
    clearFootprint(world, z, () => (offshore ? RIVER : (RUBBLE + rng(3)) | BULLBIT));
    if (offshore)
      for (let i = -1; i <= z.size; i++) {
        fixZone(world, z.cx - 1 + i, z.cy - 2);
        fixZone(world, z.cx - 1 + i, z.cy - 1 + z.size);
      }
    return { ok: true, cost };
  }
  if (isDirt(v)) return fail('Nothing to bulldoze', 'info');
  if (id >= FIRE && id <= LASTFIRE) return fail("Can't bulldoze fire; wait for it to burn out", 'info');
  if (isWater(v)) {
    // Shoreline edges are bulldozable: landfill. Open water is not.
    if (id >= FIRSTRIVEDGE && id <= LASTRIVEDGE && v & BULLBIT) {
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
  const clearable =
    isRoad(v) || isRail(v) || isWire(v) || isTree(v) || isRubble(v) || isHouse(v) || isParkTile(id) || (id >= FLOOD && id <= LASTFLOOD) || id === RADTILE;
  if (!clearable) return fail("Can't bulldoze that", 'info');
  if (p.funds < 1) return fail('Not enough funds');
  world.set(x, y, DIRT);
  fixZone(world, x, y);
  return { ok: true, cost: 1 };
}

function layRoad(world: BuildWorld, p: BuildPlayer, x: number, y: number): BuildResult {
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

function layRail(world: BuildWorld, p: BuildPlayer, x: number, y: number): BuildResult {
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

function layWire(world: BuildWorld, p: BuildPlayer, x: number, y: number): BuildResult {
  const v = world.get(x, y);
  const id = v & LOMASK;
  let tile: number;
  let cost: number;
  if (isWater(v)) {
    // Micropolis' names are misleading here: tile 208 (HPOWER) draws the cable north-south and 209 (VPOWER)
    // east-west, so a horizontal run uses VPOWER.
    tile = (orientation(world, x, y, wireLike) === 'h' ? VPOWER : HPOWER) | CONDBIT | BULLBIT;
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

function layPark(world: BuildWorld, p: BuildPlayer, x: number, y: number, rng: BuildRng): BuildResult {
  const v = world.get(x, y);
  if (!isDirt(v) && !isRubble(v)) return fail('Parks need clear land');
  const cost = TOOLS.park.cost;
  if (p.funds < cost) return fail('Not enough funds');
  // Micropolis: 1 in 4 parks is an animated fountain, the rest WOODS2..WOODS5.
  const tile = rng(3) === 0 ? FOUNTAIN | BLBNBIT | ANIMBIT : (WOODS2 + rng(3)) | BLBNBIT;
  world.set(x, y, tile);
  return { ok: true, cost };
}

/**
 * Zones (3x3) and buildings (4x4, 6x6): footprint must be dirt/tree/rubble or overland power line;
 * those are auto-bulldozed at AUTO_BULLDOZE_COST each. Zone tiles conduct, so a line running through
 * the footprint keeps carrying power across the zone.
 */
function placeZone(world: BuildWorld, p: BuildPlayer, base: number, size: number, baseCost: number, x0: number, y0: number): BuildResult {
  let cost = baseCost;
  let clearedWire = false;
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const v = world.get(x0 + dx, y0 + dy);
      if (isPlainWire(v & LOMASK)) {
        cost += AUTO_BULLDOZE_COST;
        clearedWire = true;
        continue;
      }
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
      fixTile(world, x0 + i, y0 - 1);
      fixTile(world, x0 + i, y0 + size);
      fixTile(world, x0 - 1, y0 + i);
      fixTile(world, x0 + size, y0 + i);
    }
  }
  if (base === PORTBASE && !waterNear(world, x0, y0, size, SEAPORT_WATER_RANGE)) {
    return { ok: true, cost, msg: 'Your seaport needs to be near open water (not ice) to attract industry' };
  }
  return { ok: true, cost };
}

/**
 * Custom-layer building (any w x h): footprint must be clear like a zone; tiles are CUSTOMFILL, the hot-spot
 * tile at (1,1) is CUSTOMCENTRE with ZONEBIT, all burnable and conductive; the registry records the kind.
 */
function placeCustom(world: BuildWorld, p: BuildPlayer, kind: string, baseCost: number, x0: number, y0: number): BuildResult {
  const def = CUSTOM_BUILDINGS[kind];
  let cost = baseCost;
  for (let dy = 0; dy < def.h; dy++)
    for (let dx = 0; dx < def.w; dx++) {
      const v = world.get(x0 + dx, y0 + dy);
      if (dy === def.railRow) {
        // the rail row: clear land, or an existing straight east-west line that the station is built over
        if ((v & LOMASK) === LHRAIL) continue;
        if (isRail(v)) return fail(`${def.name} needs a straight east-west stretch of rail (no junctions or crossings)`);
      }
      if (isPlainWire(v & LOMASK)) {
        cost += AUTO_BULLDOZE_COST;
        continue;
      }
      const extra = clearCost(v);
      if (extra < 0) return fail(isWater(v) ? "Can't build on water" : 'Area must be clear');
      cost += extra;
    }
  if (p.funds < cost) return fail('Not enough funds');
  for (let dy = 0; dy < def.h; dy++)
    for (let dx = 0; dx < def.w; dx++) {
      if (dy === def.railRow) {
        const old = world.get(x0 + dx, y0 + dy);
        if ((old & LOMASK) !== LHRAIL) world.set(x0 + dx, y0 + dy, LHRAIL | BLBNBIT);
        continue;
      }
      world.set(x0 + dx, y0 + dy, dx === 1 && dy === 1 ? CUSTOMCENTRE | BNCNBIT | ZONEBIT | BULLBIT : CUSTOMFILL | BNCNBIT);
    }
  world.buildings.add(kind, x0, y0);
  // join the station's track to rail built up to either end (and any line running into it)
  if (def.railRow !== undefined) for (let dx = 0; dx < def.w; dx++) fixZone(world, x0 + dx, y0 + def.railRow);
  return { ok: true, cost };
}

/**
 * Offshore wind farm: every footprint tile must be water (open sea or shoreline). The tiles conduct power
 * (connect with an underwater power line) but don't burn, and removing the farm leaves water.
 */
function placeOffshore(world: BuildWorld, p: BuildPlayer, base: number, size: number, cost: number, x0: number, y0: number): BuildResult {
  for (let dy = 0; dy < size; dy++)
    for (let dx = 0; dx < size; dx++) {
      if (!isWater(world.get(x0 + dx, y0 + dy))) return fail('An offshore wind farm must be placed entirely on water');
      if (world.frozen(x0 + dx, y0 + dy)) return fail('An offshore wind farm needs open water, not ice');
    }
  if (p.funds < cost) return fail('Not enough funds');
  let t = base;
  for (let dy = 0; dy < size; dy++)
    for (let dx = 0; dx < size; dx++) {
      let v = t++ | CONDBIT | BULLBIT;
      if (dx === 1 && dy === 1) v |= ZONEBIT;
      world.set(x0 + dx, y0 + dy, v);
    }
  return { ok: true, cost };
}

/** Tiles from the footprint edge within which a seaport must find water to count (the simulation uses the same rule). */
export const SEAPORT_WATER_RANGE = 6;

/** Any open (unfrozen) water tile within `range` tiles (Chebyshev) of the size x size footprint whose top-left is (x0,y0)? */
export function waterNear(world: Pick<BuildWorld, 'get' | 'frozen'>, x0: number, y0: number, size: number, range: number): boolean {
  for (let y = y0 - range; y < y0 + size + range; y++) {
    if (y < 0 || y >= WORLD_H) continue;
    for (let x = x0 - range; x < x0 + size + range; x++) {
      if (x >= 0 && x < WORLD_W && isWater(world.get(x, y)) && !world.frozen(x, y)) return true;
    }
  }
  return false;
}
