// Applying build tools (the 'build' client message). The rules themselves are shared (shared/src/build.ts) so
// the client can predict a build; this adapts the world and the player record to them and books the cost.

import {
  type ToolId,
  type QueryInfo,
  WORLD_W,
  Biome,
  baseBiome,
  baseIsFrozen,
  LOMASK,
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
  HROADPOWER,
  VROADPOWER,
  LTRFBASE,
  HTRFBASE,
  LASTROAD,
  POLICE_RANGE,
  isUnderwaterWireId,
  RAILHPOWERV,
  RAILVPOWERH,
  HRAIL,
  VRAIL,
  HRAILROAD,
  VRAILROAD,
  FREEZ,
  COMCLR,
  INDCLR,
  HOSPITALBASE,
  CHURCHBASE,
  COMBASE,
  PORTBASE,
  LASTPORT,
  AIRPORTBASE,
  LASTAIRPORT,
  COALBASE,
  LASTPOWERPLANT,
  FIRESTBASE,
  POLICESTBASE,
  STADIUMBASE,
  FULLSTADIUMBASE,
  NUCLEARBASE,
  LASTZONE,
  chunkOf,
  isDirt,
  isWater,
  isTree,
  isRubble,
  isRoad,
  isRail,
  isWire,
  isHouse,
  isResZone,
  isComZone,
  isIndZone,
  isPowered,
  CITYHALLBASE,
  LASTCITYHALL,
  SCHOOLBASE,
  LASTSCHOOL,
  WINDBASE,
  LASTWIND,
  OFFSHOREBASE,
  LASTOFFSHORE,
  displayPopulation,
  CUSTOM_BUILDINGS,
  isCustomTile,
  inSeason,
  applyBuildRules,
  countCustomIn,
  countMilestoneIn,
  findZoneCenter,
  isBuildingTile,
  isParkTile,
  type BuildPlayer,
  type BuildResult,
} from '@globalcity/shared';
import type { World } from './world.ts';
import type { Players, PlayerRecord } from './players.ts';
import { unlockedOf, spend, seasonMonth } from './players.ts';
import { zonePop, zoneKind } from './zones.ts';
import { randInt } from './util.ts';

export { fixZone, trafficLevel, waterNear, SEAPORT_WATER_RANGE, type BuildResult } from '@globalcity/shared';

export interface BuildCtx {
  world: World;
  players: Players;
  /** number of cities on the rail network through tile (x,y), for the query tool (optional) */
  railCitiesAt?: (x: number, y: number) => number;
}

/** How many custom-layer buildings of `kind` stand in p's plots. */
export function countCustom(world: World, p: PlayerRecord, kind: string): number {
  return countCustomIn(world, p.chunks, kind);
}

/** How many of milestone building `b` stand in p's plots (tile buildings by centre id, custom ones by kind). */
export function countMilestone(world: World, p: PlayerRecord, b: string): number {
  return countMilestoneIn(world, p.chunks, b);
}

/** The player record as the shared build rules see it. */
function buildPlayer(ctx: BuildCtx, p: PlayerRecord): BuildPlayer {
  const { world, players } = ctx;
  return {
    get funds() {
      return p.funds;
    },
    ownsChunk: (cx, cy) => players.ownsChunk(p, cx, cy),
    unlocked: () => unlockedOf(p),
    inSeason: (tool) => inSeason(tool, seasonMonth()),
    get railLinked() {
      return !!p.railLinked;
    },
    countMilestone: (b) => countMilestone(world, p, b),
    countCustom: (kind) => countCustom(world, p, kind),
  };
}

export function applyBuild(ctx: BuildCtx, p: PlayerRecord, toolId: ToolId, x: number, y: number, opts: { ignoreMilestones?: boolean } = {}): BuildResult {
  const result = applyBuildRules(ctx.world, buildPlayer(ctx, p), toolId, x, y, opts, randInt);
  if (result.ok) {
    spend(p, 'construction', result.cost);
    p.active = true;
    ctx.players.dirty = true;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Query tool
// ---------------------------------------------------------------------------

export function queryTile(ctx: BuildCtx, x: number, y: number): QueryInfo {
  const { world, players } = ctx;
  const v = world.get(x, y);
  let name: string;
  let zonePopN: number | undefined;
  let zoneKindQ: 'res' | 'com' | 'ind' | undefined;
  let powered = isPowered(v);

  const zone = isBuildingTile(v) ? findZoneCenter(world, x, y) : null;
  const custom = isCustomTile(v) ? world.buildings.at(x, y) : undefined;
  if (zone) {
    const cv = world.get(zone.cx, zone.cy);
    powered = isPowered(cv);
    const kind = zoneKind(cv);
    if (kind === 'res' || kind === 'com' || kind === 'ind') {
      // the same scale as the city's population: zone units x20 for homes, x8 x20 for jobs (displayPopulation)
      const units = zonePop(world, zone.cx, zone.cy, cv);
      zonePopN = kind === 'res' ? displayPopulation(units, 0, 0) : displayPopulation(0, units, 0);
      zoneKindQ = kind;
      const cid = cv & LOMASK;
      const empty = cid === FREEZ || cid === COMCLR || cid === INDCLR;
      const label = kind === 'res' ? 'Residential' : kind === 'com' ? 'Commercial' : 'Industrial';
      name = `${label} zone${empty && kind !== 'res' ? ' (empty)' : ''}`;
    } else {
      name = custom ? (CUSTOM_BUILDINGS[custom.kind]?.name ?? 'Building') : buildingName(cv & LOMASK);
    }
  } else {
    name = terrainName(v, world.base[y * WORLD_W + x]);
    if (isRail(v) && ctx.railCitiesAt) {
      const n = ctx.railCitiesAt(x, y);
      if (n >= 2) name = `${name} (links ${n} cities)`;
    }
  }
  const c = chunkOf(x, y);
  const owner = players.ownerOf(c.cx, c.cy);
  const info: QueryInfo = { x, y, tile: v, name, powered };
  if (owner) info.owner = players.publicOf(owner);
  if (zonePopN !== undefined) {
    info.zonePop = zonePopN;
    if (zoneKindQ) info.zoneKind = zoneKindQ;
  }
  return info;
}

function buildingName(id: number): string {
  if (id >= HOSPITALBASE && id < CHURCHBASE) return 'Hospital';
  if (id >= CHURCHBASE && id < COMBASE) return 'Church';
  if (id >= PORTBASE && id <= LASTPORT) return 'Seaport';
  if (id >= CITYHALLBASE && id <= LASTCITYHALL) return 'City hall';
  if (id >= SCHOOLBASE && id <= LASTSCHOOL) return 'Elementary school';
  if (id >= WINDBASE && id <= LASTWIND) return 'Wind farm';
  if (id >= OFFSHOREBASE && id <= LASTOFFSHORE) return 'Offshore wind farm';
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

const GROUND_NAMES: Record<Biome, string> = {
  [Biome.Temperate]: 'Dirt',
  [Biome.Desert]: 'Sand',
  [Biome.Steppe]: 'Dry grass',
  [Biome.Tundra]: 'Tundra',
  [Biome.Boreal]: 'Snowy ground',
  [Biome.Snow]: 'Ice sheet',
};
function terrainName(v: number, base: number): string {
  const id = v & LOMASK;
  if (isDirt(v)) return GROUND_NAMES[baseBiome(base)] ?? 'Dirt';
  if (isWater(v))
    return baseIsFrozen(base)
      ? id >= FIRSTRIVEDGE && id <= LASTRIVEDGE
        ? 'Icy shore'
        : 'Ice'
      : id >= FIRSTRIVEDGE && id <= LASTRIVEDGE
        ? 'Shoreline'
        : 'Water';
  if (isTree(v)) return baseBiome(base) === Biome.Boreal ? 'Snowy woods' : 'Woods';
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
  if (isUnderwaterWireId(id)) return 'Underwater power line';
  if (isWire(v)) return 'Power line';
  if (id === HRAIL || id === VRAIL) return 'Underwater rail';
  if (isRail(v)) return 'Rail';
  if (isHouse(v)) return 'House';
  return buildingName(id);
}
