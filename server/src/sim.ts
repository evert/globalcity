// Simulation: one tick = one game month, run for every active city (player with built tiles).
// Rules are a readable simplification of Micropolis (power scan, zone growth, RCI valves, taxes),
// plus cross-border power trading, fire (doFire/fireZone), neighbour and rail-link demand,
// abandonment (idle cities' plots are released, buildings intact, for others to claim), traffic (makeTraffic),
// special buildings (stadium/seaport/airport demand, police vs crime) and ambient animation flags
// (coal/industrial smoke, stadium games, airport radar, nuclear swirl; the client cycles ANIMBIT tiles).

import {
  WORLD_W, WORLD_H, CHUNK, DEMAND_SMOOTHING, TAX_RATE, TAX_MULT, COAL_POWER, NUCLEAR_POWER, POWER_PRICE_PER_UNIT,
  UPKEEP_ROAD, UPKEEP_RAIL, UPKEEP_STATION, UPKEEP_COAL, UPKEEP_NUCLEAR, CITY_FREEZE_MS,
  POLICESTATION,
  FIRE_SPREAD_P, FIRE_BURNOUT_P, FIRE_BURNOUT_P_COVERED, FIRE_STATION_RANGE, FIRE_OUTBREAK_BASE_P, FIRE_OWNER_ONLINE_MS, FIRE_PREVENTED_P,
  REGROW_MS, REGROW_P,
  ABANDON_IDLE_DAYS, ABANDON_FREE_DAYS, SMALL_CITY_MAX_ITEMS, SMALL_CITY_RELEASE_MS, NEIGHBOUR_DEMAND_MAX, RAIL_LINK_BOOST, RAIL_LINK_MAX,
  TRAFFIC_MAX_STEPS, TRAFFIC_ADD, TRAFFIC_DECAY, TRAFFIC_LIGHT, TRAFFIC_HEAVY, TRAFFIC_RAIL_SHARE, TRAFFIC_RAIL_REACH,
  STADIUM_RES_BOOST, SEAPORT_IND_BOOST, AIRPORT_COM_BOOST, POLICE_RANGE, CRIME_PER_POP,
  HBRIDGE, VBRIDGE, HPOWER, VPOWER, HRAIL, VRAIL, ROADBASE, LTRFBASE, HTRFBASE,
  LOMASK, ZONEBIT, CONDBIT, PWRBIT, ANIMBIT, BULLBIT, BURNBIT, BLBNCNBIT, BNCNBIT,
  DIRT, RUBBLE, FIRE, LASTFIRE, WOODS2, WOODS5, FOUNTAIN,
  FREEZ, RZB, HOUSE, RESBASE, COMCLR, CZB, COMBASE, INDCLR, IZB, INDBASE, POWERPLANT, FIRESTATION, HRAILROAD, VRAILROAD,
  COALBASE, STADIUM, FULLSTADIUM, STADIUMBASE, FULLSTADIUMBASE, PORT, AIRPORT,
  COAL_SMOKE, IND_SMOKE, STADIUM_GAME, NUKE_SWIRL, AIRPORT_RADAR, roadPiece, trafficTile,
  resBuildingCenter, comBuildingCenter, indBuildingCenter, resZonePop, comZonePop, indZonePop, displayPopulation,
  isRoad, isRail, isWire, isTree, isWater, isIndZone, isComZone, isHouse, isRubble, chunkKey, parseChunkKey, inWorld, clamp,
  HOSPITAL, CHURCH, HOSPITALBASE, CHURCHBASE,
  type ClaimInfo, type Demand, type GameTime,
  CITYHALL, CITYHALL_TAX_BONUS, CITYHALL_CRIME_FACTOR, UPKEEP_CITYHALL,
  MILESTONE_BUILDINGS, milestoneUnlocksFor,
  lotHash, CRIME_LAND_VALUE_THRESHOLD,
  WINDFARM, OFFSHORE, SCHOOL, WIND_POWER, OFFSHORE_POWER, UPKEEP_WIND, UPKEEP_OFFSHORE, UPKEEP_SCHOOL, SCHOOL_RANGE,
  milestoneForCentre, pollutionSource, pollutionAt, POLLUTION_HIGH, POLLUTION_SEVERE, POLLUTION_MAX_RADIUS,
  NUCLEAR,
  MILESTONE_ORDER,
  CUSTOMCENTRE, UPKEEP_UNIVERSITY, UNIVERSITY_RANGE, UNIVERSITY_POLICE_FACTOR, UNIVERSITY_IND_BOOST, GRAND_CENTRAL_RANGE, GRAND_CENTRAL_RAIL_BOOST, UPKEEP_GRANDCENTRAL,
} from '@globalcity/shared';
import { type World, chunkIndex, chunkCoords, type ChunkIndex } from './world.ts';
import type { AirportInfo, PortInfo } from '@globalcity/shared';
import type { Players, PlayerRecord } from './players.ts';
import { unlockedOf, refreshMilestoneStats, earn, spend, repayLifeline, closeYear, budgetStats } from './players.ts';
import { ShippingPlanner } from './shipping.ts';
import { zoneKind, isPlantCenter, countHouses, plopZone, findZoneCenter, isBuildingTile, clearFootprint } from './zones.ts';
import { waterNear, SEAPORT_WATER_RANGE } from './tools.ts';
import { chance, randInt, log } from './util.ts';

/** Tax multiplier: tuned so a town of ~20 full R, 8 C, 8 I zones earns ~$2600 per game year. */
/** Growth odds per tick: one house step / one density step, scaled by demand (0..1). */
const HOUSE_GROW_P = 0.6;
const DENSITY_GROW_P = 0.25;
const NO_SERVICE_SHRINK_P = 1 / 8;
const NEG_DEMAND_SHRINK_P = 1 / 32;
const POWER_FILL_CAP = 200_000;
/** A count of 0 for every milestone building (so a destroyed one reads 0, not missing). */
const zeroBuilt = (): Record<string, number> => Object.fromEntries([...MILESTONE_ORDER, 'grandcentral'].map((b) => [b, 0]));
/** Zones powered by one plant, by its centre tile id. */
const plantSupply = (id: number): number =>
  id === POWERPLANT ? COAL_POWER : id === NUCLEAR ? NUCLEAR_POWER : id === WINDFARM ? WIND_POWER : id === OFFSHORE ? OFFSHORE_POWER : 0;
/** SMALL_CITY_RELEASE_MS can be overridden by the environment (tests use a few seconds). */
const SMALL_RELEASE_MS = Number(process.env.SMALL_CITY_RELEASE_MS) || SMALL_CITY_RELEASE_MS;
/** REGROW_MS and REGROW_P can be overridden by the environment (tests use a few seconds and a high chance). */
const REGROW_EVERY_MS = Number(process.env.REGROW_MS) || REGROW_MS;
const REGROW_CHANCE = Number(process.env.REGROW_P) || REGROW_P;
/** CITY_FREEZE_MS can be overridden by the environment (tests use a few seconds). */
const FREEZE_MS = Number(process.env.CITY_FREEZE_MS) || CITY_FREEZE_MS;
/** Rail networks are recomputed at most this often (in ticks) when only zones next to track changed. */
const RAIL_RECOMPUTE_TICKS = 5;
/** Random outbreak probability per city per tick never exceeds this, however big the city. */
const FIRE_OUTBREAK_MAX_P = 0.05;
/** Rail network BFS: total rail tiles visited per rebuild. */
const RAIL_FILL_CAP = 500_000;
/** A rail-linked city counts at least this fraction of RAIL_LINK_BOOST even while it has no population yet. */
const RAIL_LINK_MIN_SCALE = 0.1;
/** Displayed population at which a rail-linked city gives the full RAIL_LINK_BOOST. */
const RAIL_LINK_FULL_POP = 2000;
/** Stadium cadence (Micropolis doSpecialZone): an empty powered stadium starts a game with p = 1/32 per tick, a full one empties with p = 1/8. */
const STADIUM_GAME_P = 1 / 32;
const STADIUM_EMPTY_P = 1 / 8;
/** Crime level at or above which lots outside police cover lose a land-value point. */
/**
 * Road pieces that get traffic variants: the 11 plain shapes plus the two road/wire crossings (pieces 2..14).
 * Bridges (0, 1) never carry traffic (Micropolis doRoad handles them as drawbridges) and piece 15 (BRWH) is not a road.
 */
const TRAFFIC_PIECE_MIN = 2, TRAFFIC_PIECE_MAX = 14;
/** Density -> traffic level 0/1/2. */
const trafficLevelFor = (d: number): 0 | 1 | 2 => (d >= TRAFFIC_HEAVY ? 2 : d >= TRAFFIC_LIGHT ? 1 : 0);
/** Current traffic level of a road tile id. */
const tileTrafficLevel = (id: number): 0 | 1 | 2 => (id < LTRFBASE ? 0 : id < HTRFBASE ? 1 : 2);
/** Chebyshev distance between tile index i and (x,y). */
const chebyshev = (i: number, x: number, y: number): number => { const sx = i % WORLD_W, sy = (i - sx) / WORLD_W; return Math.max(Math.abs(sx - x), Math.abs(sy - y)); };

export interface SimToast { playerId: string; msg: string; kind: 'info' | 'error' | 'success'; at?: { x: number; y: number } }

export interface TickResult {
  time: GameTime;
  /** claims whose pop or idleDays changed this tick */
  claimsChanged: ClaimInfo[];
  /** per-player notifications produced by this tick (fire, power trade) */
  toasts: SimToast[];
  /** chunks released this tick because their owner abandoned the city */
  unclaimed: { cx: number; cy: number }[];
}

export interface SimOptions {
  /** random fire outbreaks (default true; tests turn them off) */
  randomFires?: boolean;
}

interface PowerScan {
  /** tile index -> connected to some plant's grid (has(i) is a stamp lookup, no per-tick allocation) */
  grid: { has(i: number): boolean };
  /** zone centres browned out this tick */
  brownout: Set<number>;
}

/** One city's share of a connected power grid. */
interface GridCity { p: PlayerRecord; supply: number; zones: number[]; bought: number }

interface TradeBook {
  /** $ net per player this tick (positive = income), fractional */
  net: Map<string, number>;
  /** $ committed by importers this tick across grids, for the "must be able to pay" cap */
  spent: Map<string, number>;
  buyFrom: Map<string, Set<string>>;
  sellTo: Map<string, Set<string>>;
}

interface CityCounters {
  R: number; C: number; I: number; zones: number; rci: number; plants: number; supply: number; demand: number;
  stations: number; resZones: number; civic: number;
  /** yearly upkeep of what stands, by budget line */
  upkeep: { roads: number; rail: number; power: number; services: number };
  police: number; stadium: number; seaport: number; airport: number; roads: number;
  /** milestone buildings standing (powered or not), and powered city halls */
  /** milestone buildings standing by id (powered or not), and powered city halls */
  built: Record<string, number>; hall: number; university: number;
}

/**
 * Deterministic per-lot randomness in [0,1): the same zone always gets the same answer, so its
 * character (land-value jitter, how tall it may grow, industrial style) is stable across ticks and
 * restarts, while neighbouring lots differ. Without this every zone converges on the same sprite.
 */
/** Tallest building this lot will grow (SimCity cities are a mix of low-rise and towers). */
function maxDensity(kind: 'res' | 'com' | 'ind', x: number, y: number): number {
  const h = lotHash(x, y, 2);
  if (kind === 'res') return h < 0.15 ? 1 : h < 0.45 ? 2 : 3;
  if (kind === 'com') return h < 0.15 ? 1 : h < 0.4 ? 2 : h < 0.7 ? 3 : 4;
  return h < 0.2 ? 1 : h < 0.5 ? 2 : 3;
}
/** Roughly one hospital or church per this many residential zones. */
const CIVIC_PER_RES_ZONES = 6;
const CIVIC_P = 0.05;

const roadLike = (v: number): boolean => { const id = v & LOMASK; return isRoad(v) || id === HRAILROAD || id === VRAILROAD; };
/** Transport access for zone growth, as in Micropolis' RoadTest: any road or rail tile (power lines don't count). */
const transportLike = (v: number): boolean => isRoad(v) || isRail(v);
const isFireTile = (v: number): boolean => { const id = v & LOMASK; return id >= FIRE && id <= LASTFIRE; };
const isParkTile = (v: number): boolean => { const id = v & LOMASK; return (id >= WOODS2 && id <= WOODS5) || id === FOUNTAIN; };
const rubbleTile = (): number => (RUBBLE + randInt(3)) | BULLBIT;
/** Tiles a rail network "serves": any multi-tile zone/building tile or a house. */
const zoneLike = (v: number): boolean => isBuildingTile(v) || isHouse(v);
const fireTile = (): number => (FIRE + randInt(LASTFIRE - FIRE)) | ANIMBIT; // no BULLBIT/BURNBIT/CONDBIT: fire can't be dozed and breaks wires

export class Sim {
  tickCount = 0;
  private readonly randomFires: boolean;
  private readonly queue = new Int32Array(POWER_FILL_CAP + 4);
  private readonly lastPop = new Map<string, number>();
  /** $ net from power trading this tick per city, booked by cityStep's monthly settlement */
  private readonly tradeNet = new Map<string, number>();
  /** last announced trade partner sets (sorted ids joined), so toasts only fire on change */
  private readonly tradePartners = new Map<string, { buy: string; sell: string }>();
  /** chunks that contain at least one fire tile (kept small; fire processing only scans these) */
  readonly fireChunks = new Set<ChunkIndex>();
  /** fire tile indices that burn down to dirt (trees, parks) instead of rubble */
  private readonly fireToDirt = new Set<number>();
  /** tiles ignited since the last fire step: they burn for at least one full tick before spreading/burning out */
  private readonly freshFires = new Set<number>();
  /** players whose stats.fires was > 0 last tick */
  private readonly burning = new Set<string>();
  /** powered fire station centres (tile indices) collected during this tick's city steps */
  private stations: number[] = [];
  /** powered airports found during the current tick, swapped into `airports` at the end of it */
  private airportsNext: AirportInfo[] = [];
  /** powered airports as of the last tick (published to clients for inter-city flights) */
  airports: AirportInfo[] = [];
  /** powered seaports with water nearby, collected during the tick */
  private seaportsNext: PortInfo[] = [];
  /** sea routes between seaports (ships sail them, see shared/ships.ts) */
  readonly shipping: ShippingPlanner;
  /** powered police station centres: last tick's list (read by landValue) and the one being collected */
  private police: number[] = [];
  private nextPolice: number[] = [];
  /** each police station's reach (doubled in a city with a powered university), parallel to `police` */
  private policeRange: number[] = [];
  private nextPoliceRange: number[] = [];
  /** cities with a powered university: last tick's set (read when collecting police stations) and the one being collected */
  private uniCities = new Set<string>();
  private nextUniCities = new Set<string>();
  /** powered school centres (last tick / this tick), for land value */
  private schools: number[] = [];
  private nextSchools: number[] = [];
  private universities: number[] = [];
  private nextUniversities: number[] = [];
  /** powered Grand Central centres (tile index) and the cities that have one, from the last tick */
  private grandCentrals: number[] = [];
  private nextGrandCentrals: number[] = [];
  private gcCities = new Set<string>();
  private nextGcCities = new Set<string>();
  /** crime level of the city whose step is running (last tick's stats.crime) */
  private curCrime = 0;
  // Traffic (simplified makeTraffic): per-chunk density maps for claimed chunks only, created lazily.
  private readonly density = new Map<ChunkIndex, Uint8Array>();
  /** claimed chunks whose road tiles were normalised to their density since boot (persisted traffic variants reset) */
  private readonly trafficSeen = new Set<ChunkIndex>();
  /** road tiles per city counted in this tick's city step (denominator of stats.traffic) */
  private readonly roadCount = new Map<string, number>();
  /** per city: hospitals+churches and residential zones seen last tick (drives civic building placement) */
  private civic = new Map<string, { civic: number; resZones: number }>();
  private toasts: SimToast[] = [];
  /** last broadcast idleDays per player, so 'claims' refreshes when it changes */
  private readonly lastIdle = new Map<string, number>();
  // Rail networks (rebuilt only when a rail/zone tile or the claims change).
  private readonly railQueue = new Int32Array(RAIL_FILL_CAP + 4);
  /** rail tile index -> network id */
  private railComp = new Map<number, number>();
  /** network id -> ids of cities with a zone tile 4-adjacent to the network */
  private compCities: Set<string>[] = [];
  /** city id -> networks it is on */
  private cityComps = new Map<string, Set<number>>();
  private railVersion = -1;
  private railComputedAt = -Infinity;

  constructor(private readonly world: World, private readonly players: Players, opts: SimOptions = {}) {
    this.randomFires = opts.randomFires ?? true;
    this.seedFireChunks();
    // Saved chunks may hold traffic tiles from before the restart; density starts at 0, so redraw them plain.
    for (const ci of world.loaded) { this.applyTrafficLevels(ci, null); this.trafficSeen.add(ci); }
    // Milestones must not depend on a city being simulated (frozen cities skip ticks): derive peak
    // population, standing milestone buildings and grandfathering for every city straight from the save.
    for (const p of players.players.values()) if (p.chunks.length > 0) this.initMilestones(p);
    this.shipping = new ShippingPlanner(world);
    // Seed ports and airports from the save (frozen cities are not scanned until their mayor returns).
    const seed: PortInfo[] = [];
    for (const p of players.players.values()) for (const key of p.chunks) {
      const { cx, cy } = parseChunkKey(key);
      for (let dy = 0; dy < CHUNK; dy++) for (let dx = 0; dx < CHUNK; dx++) {
        const x = cx * CHUNK + dx, y = cy * CHUNK + dy, v = world.tiles[y * WORLD_W + x];
        if ((v & ZONEBIT) && (v & LOMASK) === PORT && (v & PWRBIT) && waterNear(world, x - 1, y - 1, 4, SEAPORT_WATER_RANGE)) seed.push({ x, y, ownerId: p.id });
        if ((v & ZONEBIT) && (v & LOMASK) === AIRPORT && (v & PWRBIT)) this.airports.push({ x, y, ownerId: p.id });
      }
    }
    this.shipping.setPorts(seed.sort((a, b) => a.y - b.y || a.x - b.x));
    this.shipping.step(Infinity); // the whole route map at boot (a few ms per port, a second or two in all): no re-dealt ships after a restart
    this.airports.sort((a, b) => a.y - b.y || a.x - b.x);
  }

  get time(): GameTime { return this.players.time; }

  /** Count standing milestone buildings in p's plots, grandfather any that predate unlocking, refresh stats. */
  initMilestones(p: PlayerRecord): void {
    const tiles = this.world.tiles;
    const built = zeroBuilt();
    for (const key of p.chunks) {
      const { cx, cy } = parseChunkKey(key);
      for (let dy = 0; dy < CHUNK; dy++) {
        const row = (cy * CHUNK + dy) * WORLD_W + cx * CHUNK;
        for (let dx = 0; dx < CHUNK; dx++) {
          const v = tiles[row + dx];
          if (!(v & ZONEBIT)) continue;
          const id = v & LOMASK;
          const mb = id === CUSTOMCENTRE ? this.world.buildings.at(cx * CHUNK + dx, cy * CHUNK + dy)?.kind : milestoneForCentre(id);
          if (mb && mb in built) built[mb]++;
        }
      }
    }
    p.peakPop = Math.max(p.peakPop ?? 0, p.stats.population ?? 0);
    p.stats.built = built;
    for (const [b, n] of Object.entries(p.stats.built)) if (n > 0 && !unlockedOf(p).includes(b)) (p.grandfathered ??= []).push(b);
    refreshMilestoneStats(p);
  }

  /**
   * Power grid membership as a reusable stamp per world tile: tile i is on a grid this tick when
   * gridStamp[i] === gridEpoch. Replaces a Set of hundreds of thousands of indices that was rebuilt
   * every tick (slow, and a steady source of garbage-collection pauses).
   */
  private readonly gridStamp = new Uint8Array(WORLD_W * WORLD_H);
  /** ids of cities frozen this tick (mayor away >= CITY_FREEZE_MS) */
  readonly frozen = new Set<string>();
  /** wall-clock time of the last regrowth pass (rubble turning back into landscape) */
  private lastRegrow = Date.now();
  isFrozen(id: string): boolean { return this.frozen.has(id); }
  private gridEpoch = 0;

  /** PROFILE_TICK=1: per-phase tick timings, logged as averages/max every 30 ticks. */
  private readonly profile = process.env.PROFILE_TICK === '1';
  private prof = new Map<string, { sum: number; max: number }>();
  private profMark = 0;
  private lap(name: string): void {
    if (!this.profile) return;
    const now = performance.now(), dt = now - this.profMark;
    this.profMark = now;
    const e = this.prof.get(name) ?? { sum: 0, max: 0 };
    e.sum += dt; e.max = Math.max(e.max, dt); this.prof.set(name, e);
  }
  private profReport(): void {
    if (!this.profile || this.tickCount % 30 !== 0) return;
    const parts = [...this.prof].map(([k, e]) => `${k} ${(e.sum / 30).toFixed(1)}/${e.max.toFixed(0)}`);
    log(`tick profile (avg/max ms over 30 ticks): ${parts.join(' | ')}`);
    this.prof.clear();
  }

  tick(): TickResult {
    this.tickCount++;
    this.profMark = performance.now();
    const t = this.players.time;
    t.month++;
    if (t.month >= 12) { t.month = 0; t.year++; }
    const newYear = t.month === 0;
    this.players.dirty = true;
    this.toasts = [];
    this.stations = [];
    this.police = this.nextPolice;
    this.policeRange = this.nextPoliceRange;
    this.uniCities = this.nextUniCities;
    this.schools = this.nextSchools;
    this.nextSchools = [];
    this.universities = this.nextUniversities;
    this.nextUniversities = [];
    this.grandCentrals = this.nextGrandCentrals;
    this.nextGrandCentrals = [];
    this.gcCities = this.nextGcCities;
    this.nextGcCities = new Set();
    this.nextPolice = [];
    this.nextPoliceRange = [];
    this.nextUniCities = new Set();

    // 0. Abandonment: idle owners' plots are released (buildings and all) for others to claim.
    const now = Date.now();
    const unclaimed: { cx: number; cy: number }[] = [];
    const abandoned = new Set<string>();
    const idleChanged = new Set<string>();
    for (const p of this.players.players.values()) {
      if (p.chunks.length === 0) { this.lastIdle.delete(p.id); continue; }
      if (p.monument) continue; // monuments are never released
      const idle = this.players.idleDays(p, now);
      const small = now - p.lastSeen >= SMALL_RELEASE_MS && this.builtItems(p, SMALL_CITY_MAX_ITEMS) < SMALL_CITY_MAX_ITEMS;
      if (idle >= ABANDON_FREE_DAYS || small) {
        const released = this.players.release(p);
        unclaimed.push(...released);
        this.clearReleased(released);
        this.lastIdle.delete(p.id);
        this.lastPop.delete(p.id);
        p.notice = small
          ? `Your plot was released because fewer than ${SMALL_CITY_MAX_ITEMS} things were built there and you were away for over an hour. Claim a new plot anywhere to start again (your old one too, if nobody has taken it).`
          : `Your city was released after ${idle} days without a visit: whoever claims its plots gets everything built there. Claim a plot anywhere to start again (your old ones too, if nobody has taken them).`;
        log(small
          ? `${p.name}'s city ${p.cityName || '(unnamed)'} had under ${SMALL_CITY_MAX_ITEMS} things built and its mayor was away ${Math.round((now - p.lastSeen) / 60_000)} min: released ${released.length} chunk(s)`
          : `${p.name}'s city ${p.cityName || '(unnamed)'} abandoned for ${idle} days: released ${released.length} chunk(s)`);
        continue;
      }
      if (idle >= ABANDON_IDLE_DAYS) abandoned.add(p.id);
      if (this.lastIdle.get(p.id) !== idle) { this.lastIdle.set(p.id, idle); idleChanged.add(p.id); }
    }
    this.lap('abandon');
    // Cities whose mayor is away are frozen: they skip growth, traffic and the budget entirely
    // (cheap, and an unattended city can't decline or go bankrupt). Their plants still feed the grid.
    this.frozen.clear();
    for (const p of this.players.players.values()) {
      if (p.chunks.length > 0 && (p.monument || now - p.lastSeen >= FREEZE_MS)) this.frozen.add(p.id); // monuments stay frozen for good
    }
    if (now - this.lastRegrow >= REGROW_EVERY_MS) { this.lastRegrow = now; this.regrow(); this.lap('regrow'); }
    // 1. Neighbourhood: rail networks and neighbour/rail demand for every running city with land.
    this.updateRailNetworks();
    this.lap('rail');
    for (const p of this.players.players.values()) if (p.chunks.length > 0 && !this.frozen.has(p.id)) this.neighbourhoodStep(p, abandoned);
    this.lap('neighbours');

    const withLand = [...this.players.players.values()].filter((p) => p.active && p.chunks.length > 0);
    const cities = withLand.filter((p) => !this.frozen.has(p.id));
    const power = this.powerScan(cities, withLand);
    this.lap('power');
    const claimsChanged: ClaimInfo[] = [];
    for (const p of cities) {
      this.cityStep(p, power, newYear);
      if (this.lastPop.get(p.id) !== p.stats.population) {
        this.lastPop.set(p.id, p.stats.population);
        idleChanged.delete(p.id);
        claimsChanged.push(...this.players.claimInfosOf(p));
      }
    }
    for (const id of idleChanged) {
      const p = this.players.players.get(id);
      if (p && p.chunks.length > 0) claimsChanged.push(...this.players.claimInfosOf(p));
    }
    // New year: every city's books close (after this month's settlement, which the sidebar's "last year" also
    // includes), running or not: construction is spent by frozen cities too.
    if (newYear) for (const p of this.players.players.values()) if (p.yearBook || p.budgetHistory) closeYear(p, t.year - 1);
    // The budget in the stats, for every unfrozen city with land (a city with only roads doesn't run cityStep yet).
    for (const p of this.players.players.values()) if (p.chunks.length > 0 && !this.frozen.has(p.id)) p.stats.budget = budgetStats(p, t.year);
    this.lap('cities');
    this.trafficStep(cities);
    this.lap('traffic');
    this.fireStep();
    this.lap('fire');
    this.profReport();
    // Frozen cities aren't scanned, so keep their airports from last time (planes still fly to them).
    const keepAirports = this.airports.filter((q) => this.frozen.has(q.ownerId) && this.players.players.get(q.ownerId)?.chunks.length);
    this.airports = [...this.airportsNext, ...keepAirports].sort((a, b) => a.y - b.y || a.x - b.x);
    this.airportsNext = [];
    // Frozen cities aren't scanned, so keep their ports from last time (ships still visit them).
    const keep = this.shipping.ports.filter((q) => this.frozen.has(q.ownerId) && this.players.players.get(q.ownerId)?.chunks.length);
    this.shipping.setPorts([...this.seaportsNext, ...keep].sort((a, b) => a.y - b.y || a.x - b.x));
    this.seaportsNext = [];
    this.shipping.step();
    return { time: { ...t }, claimsChanged, toasts: this.toasts, unclaimed };
  }

  /**
   * Nature returns: each rubble tile has REGROW_P chance of turning back into the landscape that was there
   * before anyone built. Only chunks that were ever built on can hold rubble; chunks of cities whose mayor is
   * playing right now are left alone (they may be clearing land to build on).
   */
  private regrow(): void {
    const tiles = this.world.tiles;
    let n = 0;
    for (const [ci, orig] of this.world.pristine) {
      const { cx, cy } = chunkCoords(ci);
      const owner = this.players.claims.get(chunkKey(cx, cy));
      if (owner && !this.frozen.has(owner)) continue;
      for (let dy = 0; dy < CHUNK; dy++) {
        const row = (cy * CHUNK + dy) * WORLD_W + cx * CHUNK;
        for (let dx = 0; dx < CHUNK; dx++) {
          if (!isRubble(tiles[row + dx]) || !chance(REGROW_CHANCE)) continue;
          const was = orig[dy * CHUNK + dx];
          if (isRubble(was)) continue;
          this.world.set(cx * CHUNK + dx, cy * CHUNK + dy, was);
          n++;
        }
      }
    }
    if (n) log(`regrow: ${n} rubble tile(s) turned back into landscape`);
  }

  /** Released plots: drop their traffic maps and redraw their roads plain (shared by idle release and abandon). */
  clearReleased(chunks: { cx: number; cy: number }[]): void {
    for (const u of chunks) { const ci = chunkIndex(u.cx, u.cy); this.density.delete(ci); this.applyTrafficLevels(ci, null); }
    this.lastDensityChunk = -1; this.lastDensityArr = null;
  }

  /**
   * Things the mayor built, counting each zone/building once (its centre) and each road, rail, power
   * line or park tile once. Stops counting at `cap` (callers only need "fewer than cap?").
   */
  private builtItems(p: PlayerRecord, cap: number): number {
    const tiles = this.world.tiles;
    let n = 0;
    for (const key of p.chunks) {
      const { cx, cy } = parseChunkKey(key);
      for (let dy = 0; dy < CHUNK; dy++) {
        const row = (cy * CHUNK + dy) * WORLD_W + cx * CHUNK;
        for (let dx = 0; dx < CHUNK; dx++) {
          const v = tiles[row + dx];
          if ((v & ZONEBIT) || isRoad(v) || isRail(v) || isWire(v) || isParkTile(v)) { if (++n >= cap) return n; }
        }
      }
    }
    return n;
  }

  // -------------------------------------------------------------------------
  // 1. Neighbourhood. Neighbours (cities owning a chunk 8-adjacent to mine) add demand: their jobs
  //    attract my residents, their residents shop in my stores. Cities linked by rail to my zones add
  //    commercial (and half as much residential) demand. Abandoned neighbours count for nothing.
  // -------------------------------------------------------------------------
  private neighbourhoodStep(p: PlayerRecord, abandoned: Set<string>): void {
    const s = p.stats;
    const nb = this.players.neighboursOf(p);
    let jobs = 0, R = 0;
    for (const id of nb) {
      const q = this.players.players.get(id);
      if (!q || abandoned.has(id)) continue;
      jobs += (q.stats.comPop + q.stats.indPop) * 8;
      R += q.stats.resPop;
    }
    s.neighbours = nb.size;
    s.neighbourDemand = {
      r: round4(clamp(jobs / 400, 0, NEIGHBOUR_DEMAND_MAX)),
      c: round4(clamp(R / 800, 0, NEIGHBOUR_DEMAND_MAX)),
      i: round4(clamp(R / 1600, 0, NEIGHBOUR_DEMAND_MAX / 2)),
    };
    const linked = new Set<string>();
    for (const comp of this.cityComps.get(p.id) ?? []) for (const id of this.compCities[comp]) if (id !== p.id) linked.add(id);
    let rail = 0;
    for (const id of linked) {
      const q = this.players.players.get(id);
      if (!q || q.chunks.length === 0 || abandoned.has(id)) continue;
      rail += RAIL_LINK_BOOST * clamp(q.stats.population / RAIL_LINK_FULL_POP, RAIL_LINK_MIN_SCALE, 1);
    }
    s.railLinks = linked.size;
    const boost = this.gcCities.has(p.id) ? GRAND_CENTRAL_RAIL_BOOST : 1; // a powered Grand Central
    s.railDemand = round4(Math.min(RAIL_LINK_MAX * boost, rail * boost));
    if (linked.size > 0 && !p.railLinked) {
      p.railLinked = true;
      this.players.dirty = true;
      refreshMilestoneStats(p);
      this.toasts.push({ playerId: p.id, kind: 'success', msg: `Your rail reaches ${[...linked].map((id) => { const q = this.players.players.get(id); return q?.cityName || q?.name || 'a neighbour'; }).sort().join(', ')}! You can now build Grand Central, a landmark station over your line. See 🏛 Milestones.` });
    }
  }

  /**
   * Rebuild rail networks if a rail/zone tile or the claims changed: BFS over 4-adjacent rail tiles
   * (crossings included) seeded from rail in claimed chunks, capped at RAIL_FILL_CAP tiles in total.
   * A city is "on" a network when a network tile touches one of its zone tiles or houses.
   */
  private updateRailNetworks(): void {
    const w = this.world;
    if (!w.railDirty && this.railVersion === this.players.claimsVersion) return;
    // Rail links only feed a demand bonus, so recomputing at most every RAIL_RECOMPUTE_TICKS is plenty
    // (busy cities change zones next to track nearly every tick).
    if (this.tickCount - this.railComputedAt < RAIL_RECOMPUTE_TICKS && this.railVersion === this.players.claimsVersion) return;
    this.railComputedAt = this.tickCount;
    w.railDirty = false;
    this.railVersion = this.players.claimsVersion;
    this.railComp = new Map();
    this.compCities = [];
    this.cityComps = new Map();
    const tiles = w.tiles;
    const queue = this.railQueue;
    let total = 0;
    const fill = (start: number): void => {
      const comp = this.compCities.length;
      const cities = new Set<string>();
      this.compCities.push(cities);
      let head = 0, tail = 0;
      queue[tail++] = start; total++;
      this.railComp.set(start, comp);
      while (head < tail) {
        const i = queue[head++];
        const x = i % WORLD_W, y = (i - x) / WORLD_W;
        const visit = (j: number): void => {
          const v = tiles[j];
          if (isRail(v)) {
            if (total < RAIL_FILL_CAP && !this.railComp.has(j)) { this.railComp.set(j, comp); queue[tail++] = j; total++; }
          } else if (zoneLike(v)) {
            const owner = this.ownerAt(j);
            if (owner) cities.add(owner.id);
          }
        };
        if (y > 0) visit(i - WORLD_W);
        if (x < WORLD_W - 1) visit(i + 1);
        if (y < WORLD_H - 1) visit(i + WORLD_W);
        if (x > 0) visit(i - 1);
      }
      for (const id of cities) {
        let set = this.cityComps.get(id);
        if (!set) { set = new Set(); this.cityComps.set(id, set); }
        set.add(comp);
      }
    };
    for (const key of this.players.claims.keys()) {
      const { cx, cy } = parseChunkKey(key);
      const x0 = cx * CHUNK, y0 = cy * CHUNK;
      for (let dy = 0; dy < CHUNK && total < RAIL_FILL_CAP; dy++) {
        let i = (y0 + dy) * WORLD_W + x0;
        for (let dx = 0; dx < CHUNK; dx++, i++) if (isRail(tiles[i]) && !this.railComp.has(i)) fill(i);
      }
    }
  }

  /** Number of cities on the rail network containing tile (x,y); 0 if it is not (known) rail. */
  railCitiesAt(x: number, y: number): number {
    const comp = this.railComp.get(y * WORLD_W + x);
    return comp === undefined ? 0 : this.compCities[comp].size;
  }

  // -------------------------------------------------------------------------
  // 1. Power: flood fill from every plant through CONDBIT tiles (whole world, so neighbouring
  //    cities share grids). Per grid, each city's own plants cover its own zones first; cities
  //    with a surplus sell to cities with a deficit at POWER_PRICE_PER_UNIT per zone-unit per
  //    month (importers must be able to pay). Unmet zones are randomly browned out.
  // -------------------------------------------------------------------------
  private powerScan(cities: PlayerRecord[], seedCities: PlayerRecord[] = cities): PowerScan {
    const tiles = this.world.tiles;
    // next epoch; on wrap-around clear the stamps (every 255 ticks, a single 32 MB fill)
    if (++this.gridEpoch > 255) { this.gridStamp.fill(0); this.gridEpoch = 1; }
    const stamp = this.gridStamp, epoch = this.gridEpoch;
    const grid = { has: (i: number): boolean => stamp[i] === epoch };
    const brownout = new Set<number>();
    const queue = this.queue;
    const book: TradeBook = { net: new Map(), spent: new Map(), buyFrom: new Map(), sellTo: new Map() };
    for (const p of cities) { p.stats.powerImported = 0; p.stats.powerExported = 0; p.stats.powerTradeNet = 0; }

    const fill = (start: number): void => {
      const plants: number[] = [];
      const zones: number[] = [];
      let head = 0, tail = 0;
      queue[tail++] = start;
      stamp[start] = epoch;
      while (head < tail) {
        const i = queue[head++];
        const v = tiles[i];
        if (v & ZONEBIT) {
          if (isPlantCenter(v)) plants.push(i);
          else zones.push(i);
        }
        if (tail >= POWER_FILL_CAP) continue;
        const x = i % WORLD_W;
        let j: number;
        if (i >= WORLD_W) { j = i - WORLD_W; if (stamp[j] !== epoch && (tiles[j] & CONDBIT)) { stamp[j] = epoch; queue[tail++] = j; } }
        if (x < WORLD_W - 1) { j = i + 1; if (stamp[j] !== epoch && (tiles[j] & CONDBIT)) { stamp[j] = epoch; queue[tail++] = j; } }
        if (i < WORLD_W * (WORLD_H - 1)) { j = i + WORLD_W; if (stamp[j] !== epoch && (tiles[j] & CONDBIT)) { stamp[j] = epoch; queue[tail++] = j; } }
        if (x > 0) { j = i - 1; if (stamp[j] !== epoch && (tiles[j] & CONDBIT)) { stamp[j] = epoch; queue[tail++] = j; } }
      }
      this.settleGrid(plants, zones, brownout, book);
    };

    // Seed fills from every plant in every active city (frozen ones too: their plants keep feeding neighbours).
    for (const p of seedCities) {
      this.forEachChunkTile(p, (i) => {
        if (isPlantCenter(tiles[i]) && !grid.has(i)) fill(i);
      });
    }
    // Apply PWRBIT to active cities' tiles (only changed tiles are written -> broadcast).
    for (const p of cities) {
      this.forEachChunkTile(p, (i, x, y) => {
        const v = tiles[i];
        const want = (v & CONDBIT) !== 0 && grid.has(i) && !brownout.has(i);
        if (want !== ((v & PWRBIT) !== 0)) this.world.set(x, y, v ^ PWRBIT);
      });
    }
    // Hand each city its net from power trading (cityStep books it with the month's taxes and upkeep) and
    // announce new trade relationships.
    for (const p of cities) {
      const net = book.net.get(p.id) ?? 0;
      this.tradeNet.set(p.id, net);
      if (net !== 0) p.stats.powerTradeNet = Math.round(net);
      const buy = sortedKey(book.buyFrom.get(p.id));
      const sell = sortedKey(book.sellTo.get(p.id));
      let prev = this.tradePartners.get(p.id);
      if (!prev) { prev = { buy: '', sell: '' }; this.tradePartners.set(p.id, prev); }
      if (buy !== prev.buy) {
        prev.buy = buy;
        if (buy) this.toasts.push({ playerId: p.id, kind: 'info', msg: `Buying ${p.stats.powerImported} units of power from ${this.names(book.buyFrom.get(p.id)!)}` });
      }
      if (sell !== prev.sell) {
        prev.sell = sell;
        if (sell) this.toasts.push({ playerId: p.id, kind: 'info', msg: `Selling ${p.stats.powerExported} units of power to ${this.names(book.sellTo.get(p.id)!)}` });
      }
    }
    return { grid, brownout };
  }

  /** Economics of one connected grid: own supply first, then surplus sold pro-rata to deficits that can pay. */
  private settleGrid(plants: number[], zones: number[], brownout: Set<number>, book: TradeBook): void {
    const tiles = this.world.tiles;
    const byId = new Map<string, GridCity>();
    const cityOf = (i: number): GridCity | null => {
      const p = this.ownerAt(i);
      if (!p) return null;
      let c = byId.get(p.id);
      if (!c) { c = { p, supply: 0, zones: [], bought: 0 }; byId.set(p.id, c); }
      return c;
    };
    for (const i of plants) {
      const c = cityOf(i);
      if (c) c.supply += plantSupply(tiles[i] & LOMASK);
    }
    for (const i of zones) {
      const c = cityOf(i);
      if (c && this.frozen.has(c.p.id)) continue; // frozen city: its zones neither draw power nor pay
      if (c) c.zones.push(i);
      else brownout.add(i); // zone on unclaimed land: nobody to bill
    }
    const cs = [...byId.values()];
    const exporters = cs.filter((c) => c.supply > c.zones.length);
    const importers = cs.filter((c) => c.supply < c.zones.length);
    const surplus = exporters.map((c) => c.supply - c.zones.length);
    const deficit = importers.map((c) => c.zones.length - c.supply);
    const traded = Math.min(sum(surplus), sum(deficit));
    if (traded > 0) {
      const offered = apportion(traded, deficit);
      let bought = 0;
      importers.forEach((c, k) => {
        const spent = book.spent.get(c.p.id) ?? 0;
        const affordable = Math.max(0, Math.floor((c.p.funds - spent) / POWER_PRICE_PER_UNIT));
        c.bought = Math.min(offered[k], affordable);
        if (c.bought <= 0) return;
        const cost = c.bought * POWER_PRICE_PER_UNIT;
        bought += c.bought;
        book.spent.set(c.p.id, spent + cost);
        book.net.set(c.p.id, (book.net.get(c.p.id) ?? 0) - cost);
        c.p.stats.powerImported += c.bought;
      });
      if (bought > 0) {
        const sold = apportion(bought, surplus);
        exporters.forEach((c, k) => {
          if (sold[k] <= 0) return;
          if (this.frozen.has(c.p.id)) return; // a frozen exporter's power is used, but its books stay as they were
          book.net.set(c.p.id, (book.net.get(c.p.id) ?? 0) + sold[k] * POWER_PRICE_PER_UNIT);
          c.p.stats.powerExported += sold[k];
          for (const imp of importers) {
            if (imp.bought <= 0) continue;
            addTo(book.sellTo, c.p.id, imp.p.id);
            addTo(book.buyFrom, imp.p.id, c.p.id);
          }
        });
      }
    }
    // Brownout: zones beyond own supply + bought units lose power this tick (random pick, as Micropolis).
    for (const c of cs) {
      const powered = Math.min(c.supply, c.zones.length) + c.bought;
      const z = c.zones;
      for (let excess = z.length - powered; excess > 0; excess--) {
        const k = randInt(z.length - 1);
        brownout.add(z[k]);
        z[k] = z[z.length - 1];
        z.pop();
      }
    }
  }

  private names(ids: Set<string>): string {
    return [...ids].map((id) => this.players.players.get(id)?.name ?? 'a neighbour').sort().join(', ');
  }

  /** Owner of the chunk containing tile index i. */
  private ownerAt(i: number): PlayerRecord | undefined {
    const x = i % WORLD_W, y = (i - x) / WORLD_W;
    return this.players.ownerOf(Math.floor(x / CHUNK), Math.floor(y / CHUNK));
  }

  private forEachChunkTile(p: PlayerRecord, fn: (i: number, x: number, y: number) => void): void {
    for (const key of p.chunks) {
      const { cx, cy } = parseChunkKey(key);
      const x0 = cx * CHUNK, y0 = cy * CHUNK;
      for (let dy = 0; dy < CHUNK; dy++) {
        const y = y0 + dy;
        let i = y * WORLD_W + x0;
        for (let dx = 0; dx < CHUNK; dx++, i++) fn(i, x0 + dx, y);
      }
    }
  }

  // -------------------------------------------------------------------------
  // 2-5. Zones, demand, taxes, stats for one city.
  // -------------------------------------------------------------------------
  private cityStep(p: PlayerRecord, power: PowerScan, newYear: boolean): void {
    const tiles = this.world.tiles;
    const c: CityCounters = {
      R: 0, C: 0, I: 0, zones: 0, rci: 0, plants: 0, supply: 0, demand: 0, stations: 0, upkeep: { roads: 0, rail: 0, power: 0, services: 0 }, resZones: 0, civic: 0,
      police: 0, stadium: 0, seaport: 0, airport: 0, roads: 0, built: zeroBuilt(), hall: 0, university: 0,
    };
    const demand = p.stats.demand;
    const prev = this.civic.get(p.id) ?? { civic: 0, resZones: 0 };
    const wantCivic = prev.civic < Math.floor(prev.resZones / CIVIC_PER_RES_ZONES);
    const cityPop = p.stats.population;
    this.curCrime = p.stats.crime;

    this.forEachChunkTile(p, (i, x, y) => {
      const v = tiles[i];
      if ((v & ZONEBIT) === 0) {
        // yearly upkeep for infrastructure (roads, rail); charged monthly below
        if (isRoad(v)) { c.upkeep.roads += UPKEEP_ROAD; c.roads++; }
        else if (isRail(v)) c.upkeep.rail += UPKEEP_RAIL;
        return;
      }
      const kind = zoneKind(v);
      const powered = (v & PWRBIT) !== 0;
      if (kind === 'coal') { c.plants++; c.supply += COAL_POWER; c.upkeep.power += UPKEEP_COAL; this.animateCoal(x, y, powered); return; }
      if (kind === 'nuclear') { c.plants++; c.supply += NUCLEAR_POWER; c.upkeep.power += UPKEEP_NUCLEAR; this.animateNuclear(x, y, powered); return; }
      if (kind === 'wind') { c.plants++; c.supply += WIND_POWER; c.upkeep.power += UPKEEP_WIND; c.built.windfarm = (c.built.windfarm ?? 0) + 1; return; }
      if (kind === 'offshore') { c.plants++; c.supply += OFFSHORE_POWER; c.upkeep.power += UPKEEP_OFFSHORE; c.built.offshore = (c.built.offshore ?? 0) + 1; return; }
      c.zones++;
      if (power.grid.has(i)) c.demand++;
      if (kind === 'other') {
        const id = v & LOMASK;
        if (id === HOSPITAL || id === CHURCH) c.civic++;
        if (id === FIRESTATION || id === POLICESTATION) c.upkeep.services += UPKEEP_STATION;
        if (id === FIRESTATION && powered) { c.stations++; this.stations.push(i); }
        if (id === POLICESTATION && powered) {
          c.police++; this.nextPolice.push(i);
          this.nextPoliceRange.push(POLICE_RANGE * (this.uniCities.has(p.id) ? UNIVERSITY_POLICE_FACTOR : 1));
        }
        const mb = id === CUSTOMCENTRE ? this.world.buildings.at(x, y)?.kind : milestoneForCentre(id);
        if (mb && mb in c.built) c.built[mb]++;
        if (mb === 'university') { c.upkeep.services += UPKEEP_UNIVERSITY; if (powered) { c.university++; this.nextUniversities.push(i); this.nextUniCities.add(p.id); } }
        if (mb === 'grandcentral') { c.upkeep.services += UPKEEP_GRANDCENTRAL; if (powered) { this.nextGrandCentrals.push(i); this.nextGcCities.add(p.id); } }
        if (id === SCHOOL) { c.upkeep.services += UPKEEP_SCHOOL; if (powered) this.nextSchools.push(i); }
        if (id === STADIUM || id === FULLSTADIUM) { if (powered) c.stadium++; this.animateStadium(x, y, v); }
        else if (id === PORT) { if (powered && waterNear(this.world, x - 1, y - 1, 4, SEAPORT_WATER_RANGE)) { c.seaport++; this.seaportsNext.push({ x, y, ownerId: p.id }); } }
        else if (id === AIRPORT) { if (powered) { c.airport++; this.airportsNext.push({ x, y, ownerId: p.id }); } this.animateAirport(x, y, powered); }
        else if (id === CITYHALL) { c.upkeep.services += UPKEEP_CITYHALL; if (powered) c.hall++; }
        return;
      }
      c.rci++;
      const road = this.hasRoadAccess(x, y);
      if (powered && road && Math.random() < this.tripChance(x, y, v, kind)) this.drive(x, y);
      switch (kind) {
        case 'res': c.resZones++; c.R += this.stepRes(x, y, v, powered && road, demand.r, wantCivic); break;
        case 'com': c.C += this.stepCom(x, y, v, powered && road, demand.c); break;
        case 'ind': c.I += this.stepInd(x, y, v, powered && road, demand.i, cityPop); this.animateInd(x, y); break;
      }
    });
    this.roadCount.set(p.id, c.roads);

    this.civic.set(p.id, { civic: c.civic, resZones: c.resZones });
    if (c.zones === 0 && c.plants === 0) p.active = false;

    // 3. RCI valves (simplified setValves). Zone-unit pops: R ~16-40 per full res zone, C/I 1-5, so jobs = (C+I)*8.
    const jobs = (c.C + c.I) * 8;
    let r = clamp((jobs + 16 - c.R) / 64, -1, 1);
    if (c.R < 50) r = Math.max(r, 0.3); // external market: a fresh city always grows
    let cd = clamp((c.R / 8 - c.C * 2) / 16, -1, 1);
    if (c.C < 4 && c.R > 0) cd = Math.max(cd, 0.2);
    let id = clamp((c.R / 8 - c.I * 2 + 4) / 16, -1, 1);
    if (c.I < 6) id = Math.max(id, 0.3);
    // Neighbours' jobs and shoppers, and rail links (commercial, half of it residential).
    // Special buildings (powered; one of each counts): a stadium draws residents, a seaport near water
    // attracts industry, an airport attracts commerce.
    const nd = p.stats.neighbourDemand, rail = p.stats.railDemand;
    r = clamp(r + nd.r + rail / 2 + (c.stadium > 0 ? STADIUM_RES_BOOST : 0), -1, 1);
    // An airport only helps once there is somewhere to fly: another mayor's powered airport (last tick's list).
    const connected = c.airport > 0 && this.airports.some((a) => a.ownerId !== p.id);
    cd = clamp(cd + nd.c + rail + (connected ? AIRPORT_COM_BOOST : 0), -1, 1);
    id = clamp(id + nd.i + (c.seaport > 0 ? SEAPORT_IND_BOOST : 0) + (c.university > 0 ? UNIVERSITY_IND_BOOST : 0), -1, 1);
    // Smoothed: the bars (and growth, which reads them next tick) drift towards the target instead of jumping.
    // A city with nobody living or working in it yet starts at its target, so a new mayor sees demand at once.
    const was = p.stats.demand, fresh = c.R + c.C + c.I === 0 || !was;
    const ease = (from: number, to: number): number => Math.round((from + (to - from) * DEMAND_SMOOTHING) * 1000) / 1000;
    const newDemand: Demand = fresh ? { r: round2(r), c: round2(cd), i: round2(id) }
      : { r: ease(was.r, r), c: ease(was.c, cd), i: ease(was.i, id) };

    // 4. Budget: this month's share of the yearly taxes and upkeep, and the power scan's trade, through the
    //    ledger (one line each). A lifeline is repaid from a surplus month. (Only running cities get here:
    //    a city whose mayor is away is frozen, see tick().)
    const yearlyTaxes = (c.R + jobs) * TAX_RATE * TAX_MULT * (c.hall > 0 ? 1 + CITYHALL_TAX_BONUS : 1);
    const yearlyUpkeep = c.upkeep.roads + c.upkeep.rail + c.upkeep.power + c.upkeep.services;
    const trade = this.tradeNet.get(p.id) ?? 0;
    this.tradeNet.delete(p.id);
    let moved = earn(p, 'taxes', yearlyTaxes / 12);
    for (const k of ['roads', 'rail', 'power', 'services'] as const) moved -= spend(p, k, c.upkeep[k] / 12);
    moved += trade > 0 ? earn(p, 'powerSold', trade) : trade < 0 ? -spend(p, 'powerBought', -trade) : 0;
    const { repaid, cleared } = repayLifeline(p, (yearlyTaxes - yearlyUpkeep) / 12 + trade);
    if (cleared) this.toasts.push({ playerId: p.id, kind: 'success', msg: 'Lifeline repaid in full. Well done, mayor!' });
    p.yearIncome += moved - repaid;
    if (newYear) {
      p.stats.lastIncome = p.yearIncome;
      p.yearIncome = 0;
    }

    // 5. Stats.
    const s = p.stats;
    s.funds = p.funds;
    s.resPop = c.R; s.comPop = c.C; s.indPop = c.I;
    s.population = displayPopulation(c.R, c.C, c.I);
    s.powerSupply = c.supply;
    s.powerDemand = c.demand;
    s.demand = newDemand;
    s.chunks = p.chunks.length;
    s.fireStations = c.stations;
    s.policeStations = c.police;
    s.specials = { stadium: c.stadium, seaport: c.seaport, airport: connected ? c.airport : 0 };
    s.crime = round4(Math.min(1, s.population * CRIME_PER_POP) * (c.hall > 0 ? CITYHALL_CRIME_FACTOR : 1));
    // Milestones: peak population, what stands, and grandfathering. Buildings that exist without having
    // been unlocked can only predate milestones (placement requires an unlock), so they are grandfathered.
    p.peakPop = Math.max(p.peakPop ?? 0, s.population);
    s.built = c.built;
    s.cityHall = c.hall;
    for (const [b, n] of Object.entries(s.built)) {
      if (n > 0 && !unlockedOf(p).includes(b)) (p.grandfathered ??= []).push(b);
    }
    refreshMilestoneStats(p);
    for (const b of milestoneUnlocksFor(p.peakPop)) {
      if ((p.announced ?? []).includes(b)) continue;
      (p.announced ??= []).push(b);
      if ((p.grandfathered ?? []).includes(b)) continue; // they already have one
      const m = MILESTONE_BUILDINGS[b];
      this.toasts.push({ playerId: p.id, kind: 'success', msg: `Milestone: ${m.pop.toLocaleString('en-US')} people! You can now build ${/^[aeiou]/i.test(m.name) ? 'an' : 'a'} ${m.name.toLowerCase()} (${m.benefits[0].toLowerCase()}). See 🏛 Milestones.` });
    }

    // 6. Random fire outbreak: p = BASE * sqrt(zones/30), capped; bigger cities burn more often.
    // Only while the owner is around (every client message touches lastSeen; pings every 20 s).
    // (No fires at all before the city reaches the fire station milestone.)
    if (this.randomFires && c.rci > 0 && Date.now() - p.lastSeen < FIRE_OWNER_ONLINE_MS && unlockedOf(p).includes('fire')) {
      const pOut = Math.min(FIRE_OUTBREAK_MAX_P, FIRE_OUTBREAK_BASE_P * Math.sqrt(c.rci / 30));
      if (chance(pOut)) this.outbreak(p);
    }
  }

  // -------------------------------------------------------------------------
  // Fire (simplified Micropolis doFire / fireZone). Fire tiles are FIRE..LASTFIRE | ANIMBIT.
  // Each tick, every burning tile may ignite burnable 4-neighbours (BURNBIT, inside a claimed
  // chunk so wildfires never roam the uninhabited world) and may burn out into rubble (trees and
  // parks into dirt). A powered fire station within FIRE_STATION_RANGE halves spread (quarters it
  // with 2+) and makes burn-out much likelier. Fire crosses chunk borders into neighbours' cities.
  // -------------------------------------------------------------------------

  /**
   * On boot, find chunks with fire tiles in saved cities so an interrupted fire keeps burning,
   * and reset every player's stats.fires to the real count (the saved value may be stale).
   */
  private seedFireChunks(): void {
    for (const p of this.players.players.values()) p.stats.fires = 0;
    for (const [key, id] of this.players.claims) {
      const { cx, cy } = parseChunkKey(key);
      const n = this.fireTilesIn(cx, cy).length;
      if (n === 0) continue;
      this.fireChunks.add(chunkIndex(cx, cy));
      const p = this.players.players.get(id);
      if (p) { p.stats.fires += n; this.burning.add(id); }
    }
  }

  /** Tile indices of all fire tiles in a chunk. */
  private fireTilesIn(cx: number, cy: number): number[] {
    const tiles = this.world.tiles;
    const x0 = cx * CHUNK, y0 = cy * CHUNK;
    const out: number[] = [];
    for (let dy = 0; dy < CHUNK; dy++) {
      let i = (y0 + dy) * WORLD_W + x0;
      for (let dx = 0; dx < CHUNK; dx++, i++) if (isFireTile(tiles[i])) out.push(i);
    }
    return out;
  }

  /**
   * Set tile (x,y) on fire if it is burnable. A tile of a multi-tile building takes the whole
   * building with it (Micropolis fireZone): the footprint turns to rubble, the hit tile burns.
   * Returns false for water, dirt, rubble, fire and anything else without BURNBIT.
   */
  ignite(x: number, y: number): boolean {
    if (!inWorld(x, y)) return false;
    const w = this.world;
    const v = w.get(x, y);
    if ((v & BURNBIT) === 0 || isFireTile(v)) return false;
    const i = y * WORLD_W + x;
    if (isBuildingTile(v)) {
      const z = findZoneCenter(w, x, y);
      if (z) clearFootprint(w, z, () => rubbleTile()); // the ignited tile becomes fire below
    } else if (isTree(v) || isParkTile(v)) {
      this.fireToDirt.add(i);
    }
    w.set(x, y, fireTile());
    this.freshFires.add(i);
    this.fireChunks.add(chunkIndex(Math.floor(x / CHUNK), Math.floor(y / CHUNK)));
    return true;
  }

  /** Random outbreak in city p: prefer a zone tile or house, else any burnable tile. */
  private outbreak(p: PlayerRecord): void {
    const tiles = this.world.tiles;
    const preferred: number[] = [];
    const other: number[] = [];
    this.forEachChunkTile(p, (i) => {
      const v = tiles[i];
      if ((v & BURNBIT) === 0 || isFireTile(v)) return;
      if (isBuildingTile(v) || isHouse(v)) preferred.push(i); else other.push(i);
    });
    const pool = preferred.length > 0 ? preferred : other;
    if (pool.length === 0) return;
    const i = pool[randInt(pool.length - 1)];
    const x = i % WORLD_W, y = (i - x) / WORLD_W;
    // Inside a powered fire station's range most outbreaks are caught before they start.
    if (this.stations.some((s) => chebyshev(s, x, y) <= FIRE_STATION_RANGE) && chance(FIRE_PREVENTED_P)) return;
    if (this.ignite(x, y)) this.toasts.push({ playerId: p.id, kind: 'error', msg: 'Fire! A blaze broke out in your city', at: { x, y } });
  }

  /**
   * Spread and burn out every fire tile in every chunk known to contain fire; update stats.fires.
   * Two phases (collect, then process), and tiles ignited since the last step are only counted, not
   * processed, so every fire burns for at least one full tick. stats.fires counts the tiles still
   * burning after this step, so "The fire is out" arrives with the last rubble tile.
   */
  private fireStep(): void {
    const tiles = this.world.tiles;
    const R = FIRE_STATION_RANGE;
    const firesByPlayer = new Map<string, number>();
    const countFor = (x: number, y: number, n: number): void => {
      const owner = this.players.ownerOf(Math.floor(x / CHUNK), Math.floor(y / CHUNK));
      if (owner) firesByPlayer.set(owner.id, (firesByPlayer.get(owner.id) ?? 0) + n);
    };
    const trySpread = (x: number, y: number, p: number): void => {
      if (!inWorld(x, y)) return;
      const v = tiles[y * WORLD_W + x];
      if ((v & BURNBIT) === 0 || isFireTile(v) || !chance(p)) return;
      const owner = this.players.ownerOf(Math.floor(x / CHUNK), Math.floor(y / CHUNK));
      if (!owner) return; // no wildfires on unclaimed land
      if (this.frozen.has(owner.id)) return; // nor into a frozen city (its mayor is away)
      if (!unlockedOf(owner).includes('fire')) return; // nor into a city too small to have fire stations
      if (this.ignite(x, y)) countFor(x, y, 1);
    };
    const work: { ci: ChunkIndex; fires: number[] }[] = [];
    for (const ci of this.fireChunks) {
      const { cx, cy } = chunkCoords(ci);
      const all = this.fireTilesIn(cx, cy);
      if (all.length === 0) { this.fireChunks.delete(ci); continue; }
      const fires = all.filter((i) => !this.freshFires.has(i));
      if (fires.length < all.length) countFor(cx * CHUNK, cy * CHUNK, all.length - fires.length);
      if (fires.length > 0) work.push({ ci, fires });
    }
    this.freshFires.clear();
    for (const { ci, fires } of work) {
      const { cx, cy } = chunkCoords(ci);
      const x0 = cx * CHUNK, y0 = cy * CHUNK;
      // Powered fire stations close enough to cover any tile of this chunk.
      const near = this.stations.filter((s) => {
        const sx = s % WORLD_W, sy = (s - sx) / WORLD_W;
        return sx >= x0 - R && sx < x0 + CHUNK + R && sy >= y0 - R && sy < y0 + CHUNK + R;
      });
      let surviving = 0;
      for (const i of fires) {
        const x = i % WORLD_W, y = (i - x) / WORLD_W;
        let cover = 0;
        for (const s of near) {
          const sx = s % WORLD_W, sy = (s - sx) / WORLD_W;
          if (Math.max(Math.abs(sx - x), Math.abs(sy - y)) <= R) cover++;
        }
        const spreadP = cover >= 2 ? FIRE_SPREAD_P / 4 : cover === 1 ? FIRE_SPREAD_P / 2 : FIRE_SPREAD_P;
        trySpread(x, y - 1, spreadP);
        trySpread(x + 1, y, spreadP);
        trySpread(x, y + 1, spreadP);
        trySpread(x - 1, y, spreadP);
        if (chance(cover > 0 ? FIRE_BURNOUT_P_COVERED : FIRE_BURNOUT_P)) {
          const toDirt = this.fireToDirt.delete(i);
          this.world.set(x, y, toDirt ? DIRT : rubbleTile());
        } else {
          surviving++;
        }
      }
      if (surviving > 0) countFor(x0, y0, surviving);
    }
    for (const [id, n] of firesByPlayer) {
      const p = this.players.players.get(id);
      if (p) p.stats.fires = n;
      this.burning.add(id);
    }
    for (const id of [...this.burning]) {
      if (firesByPlayer.has(id)) continue;
      this.burning.delete(id);
      const p = this.players.players.get(id);
      if (!p) continue;
      p.stats.fires = 0;
      this.toasts.push({ playerId: id, kind: 'success', msg: 'The fire is out.' });
    }
  }

  /** Micropolis-style road access: a road within 2 tiles of the 3x3 footprint (7x7 box around the centre). */
  /** Road or rail within the 7x7 box around a zone centre (Micropolis lets rail connect zones too). */
  private hasRoadAccess(x: number, y: number): boolean {
    const w = this.world;
    for (let dy = -3; dy <= 3; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= WORLD_H) continue;
      for (let dx = -3; dx <= 3; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= WORLD_W) continue;
        if (transportLike(w.get(xx, yy))) return true;
      }
    }
    return false;
  }

  /** Grow (true) / shrink (false) / nothing (null) decision shared by all zone kinds. */
  private decide(serviced: boolean, demand: number, growP: number): boolean | null {
    if (!serviced) return chance(NO_SERVICE_SHRINK_P) ? false : null;
    // At zero/negative demand allow a trickle of growth (10% of ticks act as if demand were 0.1).
    const d = demand > 0 ? demand : chance(0.1) ? 0.1 : 0;
    if (d > 0) return chance(growP * d) ? true : null;
    if (demand <= -0.5) return chance(NEG_DEMAND_SHRINK_P) ? false : null;
    return null;
  }

  /**
   * Land value 0..3 (cheap heuristic standing in for Micropolis' land-value map):
   * +1 nearby park/woods/water (7x7), +1 no industry within 12 tiles, +1 commerce within 8 tiles.
   */
  private landValue(x: number, y: number): number {
    const w = this.world;
    let value = 0;
    outer: for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= WORLD_W || yy >= WORLD_H) continue;
        const v = w.get(xx, yy);
        const id = v & LOMASK;
        if (isTree(v) || isWater(v) || (id >= 40 && id <= 43)) { value++; break outer; }
      }
    }
    let industry = false, commerce = false;
    let pollution = 0;
    for (let dy = -12; dy <= 12; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= WORLD_H) continue;
      for (let dx = -12; dx <= 12; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= WORLD_W) continue;
        const v = w.get(xx, yy);
        if (isIndZone(v)) industry = true;
        if (!commerce && Math.abs(dx) <= 8 && Math.abs(dy) <= 8 && isComZone(v)) commerce = true;
        const src = pollutionSource(v);
        if (src) pollution += pollutionAt(src, Math.max(Math.abs(dx), Math.abs(dy)));
      }
    }
    if (!industry) value++;
    if (commerce) value++;
    if (pollution >= POLLUTION_HIGH) value--; // smog: coal plants, factories, heavy traffic, airports, seaports
    if (pollution >= POLLUTION_SEVERE) value--; // heavy smog, close to a coal plant
    if (this.schools.some((sc) => chebyshev(sc, x, y) <= SCHOOL_RANGE)) value++; // a powered school nearby
    if (this.universities.some((u) => chebyshev(u, x, y) <= UNIVERSITY_RANGE)) value++; // a powered university nearby
    // Crime (city-wide, from population) hurts lots outside the reach of a powered police station.
    if (this.curCrime >= CRIME_LAND_VALUE_THRESHOLD && !this.policeCovers(x, y)) value--;
    // per-lot jitter so a street of identical conditions still shows different buildings
    const h = lotHash(x, y, 1);
    if (h < 0.25) value--; else if (h > 0.75) value++;
    return clamp(value, 0, 3);
  }

  /** Pollution at (x,y) from every source within POLLUTION_MAX_RADIUS (shared formula, as in the overlay). */
  private smogAt(x: number, y: number): number {
    const w = this.world, R = POLLUTION_MAX_RADIUS;
    let p = 0;
    for (let dy = -R; dy <= R; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= WORLD_H) continue;
      for (let dx = -R; dx <= R; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= WORLD_W) continue;
        const src = pollutionSource(w.get(xx, yy));
        if (src) p += pollutionAt(src, Math.max(Math.abs(dx), Math.abs(dy)));
      }
    }
    return p;
  }

  /** Smog caps how tall homes grow: one step in smog, none in heavy smog. Existing buildings don't shrink. */
  private resSmogCap(x: number, y: number): number {
    const p = this.smogAt(x, y);
    return p >= POLLUTION_SEVERE ? 0 : p >= POLLUTION_HIGH ? 1 : 3;
  }

  /** Is (x,y) within reach (Chebyshev) of a police station that was powered last tick? A university doubles the reach. */
  private policeCovers(x: number, y: number): boolean {
    for (let k = 0; k < this.police.length; k++) if (chebyshev(this.police[k], x, y) <= this.policeRange[k]) return true;
    return false;
  }

  // -------------------------------------------------------------------------
  // Traffic (simplified Micropolis makeTraffic). Every serviced R/C/I zone sends one drive per tick: a
  // random walk of up to TRAFFIC_MAX_STEPS along roads (no U-turns except at dead ends) that adds
  // TRAFFIC_ADD to each road tile it crosses. Density lives in per-chunk Uint8Arrays for claimed chunks
  // only; every tick it decays by TRAFFIC_DECAY and road tiles are redrawn as plain/light/heavy pieces
  // (traffic tiles carry ANIMBIT; the client steps them through ANI_TILE). Destinations are ignored.
  // -------------------------------------------------------------------------

  /** Add TRAFFIC_ADD (saturating) to the density of road tile (x,y) if its chunk is claimed (maps are created lazily). */
  /** Dev hook (DEV_HOOKS=1): add `amount` traffic density to road tile (x,y). Returns false off-road / unclaimed. */
  devTraffic(x: number, y: number, amount: number): boolean {
    if (!isRoad(this.world.get(x, y))) return false;
    const n = Math.ceil(amount / TRAFFIC_ADD);
    for (let i = 0; i < n; i++) this.addDensity(x, y);
    return this.lastDensityArr !== null;
  }

  private addDensity(x: number, y: number): void {
    const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK);
    const ci = chunkIndex(cx, cy);
    let arr: Uint8Array | null | undefined;
    if (ci === this.lastDensityChunk) arr = this.lastDensityArr; // consecutive steps mostly stay in one chunk
    else {
      arr = this.density.get(ci);
      if (!arr) {
        if (this.players.ownerOf(cx, cy)) { arr = new Uint8Array(CHUNK * CHUNK); this.density.set(ci, arr); }
        else arr = null; // unclaimed land: no map
      }
      this.lastDensityChunk = ci; this.lastDensityArr = arr;
    }
    if (!arr) return;
    const k = (y - cy * CHUNK) * CHUNK + (x - cx * CHUNK);
    arr[k] = Math.min(255, arr[k] + TRAFFIC_ADD);
  }
  private lastDensityChunk = -1;
  private lastDensityArr: Uint8Array | null = null;

  /** One drive from a road tile next to the 3x3 zone centred at (x,y). */
  /**
   * Odds that a serviced zone makes a road trip this tick: bigger buildings make more trips
   * (houses ~0.1, full residential 0.2..0.5, commerce/industry 0.1..0.5), and rail within
   * TRAFFIC_RAIL_REACH tiles carries TRAFFIC_RAIL_SHARE of them instead of the road.
   */
  private tripChance(x: number, y: number, v: number, kind: string): number {
    const id = v & LOMASK;
    let p: number;
    if (kind === 'res') p = id === FREEZ ? 0.1 : resZonePop(id) / 80;
    else if (kind === 'com') p = id === COMCLR ? 0 : comZonePop(id) / 10;
    else p = id === INDCLR ? 0 : indZonePop(id) / 8;
    if (p > 0 && (this.railNear(x, y) || this.grandCentrals.some((g) => chebyshev(g, x, y) <= GRAND_CENTRAL_RANGE))) p *= 1 - TRAFFIC_RAIL_SHARE;
    return p;
  }

  private railNear(x: number, y: number): boolean {
    const w = this.world;
    const r = TRAFFIC_RAIL_REACH;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) continue; // the zone's own footprint
      const tx = x + dx, ty = y + dy;
      if (inWorld(tx, ty) && isRail(w.get(tx, ty))) return true;
    }
    return false;
  }

  private drive(x: number, y: number): void {
    const w = this.world;
    // Start on a random road tile touching the footprint (the ring at Chebyshev distance 2 from the centre),
    // else one a tile further out (distance 3), the limit hasRoadAccess accepts.
    const starts: number[] = [];
    for (let r = 2; r <= 3 && starts.length === 0; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const tx = x + dx, ty = y + dy;
          if (inWorld(tx, ty) && roadLike(w.get(tx, ty))) starts.push(ty * WORLD_W + tx);
        }
      }
    }
    if (starts.length === 0) return;
    const start = starts[randInt(starts.length - 1)];
    let cx = start % WORLD_W, cy = (start - cx) / WORLD_W;
    let dir = -1; // 0 N, 1 E, 2 S, 3 W
    const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
    for (let step = 0; step < TRAFFIC_MAX_STEPS; step++) {
      if (isRoad(w.get(cx, cy))) this.addDensity(cx, cy);
      const back = dir < 0 ? -1 : (dir + 2) & 3;
      let n = 0;
      const opts = [0, 0, 0, 0];
      for (let d = 0; d < 4; d++) {
        if (d === back) continue;
        const nx = cx + DX[d], ny = cy + DY[d];
        if (inWorld(nx, ny) && roadLike(w.get(nx, ny))) opts[n++] = d;
      }
      let d: number;
      if (n > 0) d = opts[randInt(n - 1)];
      else if (back >= 0 && inWorld(cx + DX[back], cy + DY[back]) && roadLike(w.get(cx + DX[back], cy + DY[back]))) d = back; // dead end: turn around
      else return;
      cx += DX[d]; cy += DY[d]; dir = d;
    }
  }

  /**
   * After the city steps: decay every density map, redraw road tiles whose traffic level changed, drop
   * maps that reached zero, and publish stats.traffic. Claimed chunks are normalised once after boot so
   * traffic variants restored from a save fall back to plain roads (their density is 0).
   */
  private trafficStep(cities: PlayerRecord[]): void {
    for (const key of this.players.claims.keys()) {
      const { cx, cy } = parseChunkKey(key);
      const ci = chunkIndex(cx, cy);
      if (this.trafficSeen.has(ci)) continue;
      this.trafficSeen.add(ci);
      if (!this.density.has(ci)) this.applyTrafficLevels(ci, null);
    }
    this.lastDensityChunk = -1; this.lastDensityArr = null; // maps may be deleted below
    const sums = new Map<string, number>();
    for (const [ci, arr] of this.density) {
      let max = 0, sum = 0;
      for (let k = 0; k < arr.length; k++) {
        const d = arr[k];
        if (d === 0) continue;
        const nd = Math.floor(d * TRAFFIC_DECAY);
        arr[k] = nd;
        sum += nd;
        if (nd > max) max = nd;
      }
      this.applyTrafficLevels(ci, arr);
      if (max === 0) { this.density.delete(ci); continue; }
      const { cx, cy } = chunkCoords(ci);
      const owner = this.players.ownerOf(cx, cy);
      if (owner) sums.set(owner.id, (sums.get(owner.id) ?? 0) + sum);
    }
    for (const p of cities) {
      const roads = this.roadCount.get(p.id) ?? 0;
      p.stats.traffic = roads > 0 ? round4((sums.get(p.id) ?? 0) / (roads * 255)) : 0;
    }
  }

  /** Redraw every traffic-capable road tile of chunk ci at the level its density (0 if `arr` is null) calls for. */
  private applyTrafficLevels(ci: ChunkIndex, arr: Uint8Array | null): void {
    const tiles = this.world.tiles;
    const { cx, cy } = chunkCoords(ci);
    const x0 = cx * CHUNK, y0 = cy * CHUNK;
    for (let dy = 0; dy < CHUNK; dy++) {
      let i = (y0 + dy) * WORLD_W + x0;
      for (let dx = 0; dx < CHUNK; dx++, i++) {
        const v = tiles[i];
        if (!isRoad(v)) continue;
        const id = v & LOMASK;
        const piece = roadPiece(id);
        if (piece === null || piece < TRAFFIC_PIECE_MIN || piece > TRAFFIC_PIECE_MAX) continue;
        const want = trafficLevelFor(arr ? arr[dy * CHUNK + dx] : 0);
        if (tileTrafficLevel(id) === want && (want === 0 || id === trafficTile(piece, want))) continue;
        let flags = v & ~LOMASK & ~ANIMBIT;
        if (want > 0) flags |= ANIMBIT;
        this.world.set(x0 + dx, y0 + dy, trafficTile(piece, want) | flags);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Ambient animation flags (Micropolis doSpecialZone / coalSmoke / setSmoke). The server only decides
  // which cells hold an animated tile; the client cycles ANIMBIT tiles through ANI_TILE. Tiles are
  // written only when they change. PWRBIT is carried over so the power scan does not fight these writes.
  // -------------------------------------------------------------------------

  /** Coal plant: four smoke stacks (ANIMBIT|CONDBIT|PWRBIT|BURNBIT) while powered, plain footprint tiles otherwise. */
  private animateCoal(x: number, y: number, powered: boolean): void {
    const w = this.world;
    for (const s of COAL_SMOKE) {
      const tx = x + s.dx, ty = y + s.dy;
      const want = powered
        ? s.tile | ANIMBIT | CONDBIT | PWRBIT | BURNBIT
        : (COALBASE + (s.dy + 1) * 4 + (s.dx + 1)) | BNCNBIT;
      if (w.get(tx, ty) !== want) w.set(tx, ty, want);
    }
  }

  /** Nuclear plant: the swirl cell animates while powered. */
  private animateNuclear(x: number, y: number, powered: boolean): void {
    const w = this.world;
    const tx = x + NUKE_SWIRL.dx, ty = y + NUKE_SWIRL.dy;
    const old = w.get(tx, ty);
    const want = (powered ? NUKE_SWIRL.tile | ANIMBIT : NUKE_SWIRL.still) | BNCNBIT | (old & PWRBIT);
    if (old !== want) w.set(tx, ty, want);
  }

  /** Airport: the radar dish spins while powered. */
  private animateAirport(x: number, y: number, powered: boolean): void {
    const w = this.world;
    const tx = x + AIRPORT_RADAR.dx, ty = y + AIRPORT_RADAR.dy;
    const old = w.get(tx, ty);
    const want = (powered ? AIRPORT_RADAR.on | ANIMBIT : AIRPORT_RADAR.off) | BNCNBIT | (old & PWRBIT);
    if (old !== want) w.set(tx, ty, want);
  }

  /**
   * Industrial building: the variants that have chimneys show smoke while powered (setSmoke). Called after
   * the zone step, so a building that just grew (plopZone writes the still footprint) gets its smoke back.
   */
  private animateInd(x: number, y: number): void {
    const w = this.world;
    const v = w.get(x, y);
    const id = v & LOMASK;
    if (id < IZB) return; // empty zone
    const e = IND_SMOKE[((id - IZB) >> 3) & 7];
    if (!e.animates) return;
    const powered = (v & PWRBIT) !== 0;
    for (const s of [e.a, e.b]) {
      const tx = x + s.dx, ty = y + s.dy;
      const old = w.get(tx, ty);
      const want = (powered ? s.on | ANIMBIT : s.off) | BNCNBIT | (old & PWRBIT);
      if (old !== want) w.set(tx, ty, want);
    }
  }

  /** Stadium: a powered empty stadium starts a game (full stadium + two animated cells) with STADIUM_GAME_P; a full one empties with STADIUM_EMPTY_P. */
  private animateStadium(x: number, y: number, v: number): void {
    const id = v & LOMASK;
    if (id === STADIUM) {
      if ((v & PWRBIT) === 0 || !chance(STADIUM_GAME_P)) return;
      this.drawStadium(x, y, FULLSTADIUMBASE);
      for (const g of STADIUM_GAME) {
        const tx = x + g.dx, ty = y + g.dy;
        this.world.set(tx, ty, g.tile | ANIMBIT | BNCNBIT | (this.world.get(tx, ty) & PWRBIT));
      }
    } else if (id === FULLSTADIUM && chance(STADIUM_EMPTY_P)) {
      this.drawStadium(x, y, STADIUMBASE);
    }
  }

  /** Redraw the 4x4 stadium footprint around centre (x,y) from `base` (Micropolis drawStadium), keeping PWRBIT. */
  private drawStadium(x: number, y: number, base: number): void {
    const w = this.world;
    let t = base;
    for (let dy = -1; dy <= 2; dy++) {
      for (let dx = -1; dx <= 2; dx++, t++) {
        const old = w.get(x + dx, y + dy);
        let nv = t | BNCNBIT | (old & PWRBIT);
        if (dx === 0 && dy === 0) nv |= ZONEBIT | BULLBIT;
        if (old !== nv) w.set(x + dx, y + dy, nv);
      }
    }
  }

  // ---- residential ----
  private stepRes(x: number, y: number, v: number, serviced: boolean, demand: number, wantCivic = false): number {
    const w = this.world;
    const id = v & LOMASK;
    if (id === FREEZ) {
      const houses = countHouses(w, x, y);
      const action = this.decide(serviced, demand, HOUSE_GROW_P);
      if (action === true) {
        const value = this.landValue(x, y);
        if (houses < 8) { this.placeHouse(x, y, value); return houses + 1; }
        // 8 houses -> first full residential building (pop 16).
        const centre = resBuildingCenter(0, value);
        plopZone(w, x, y, centre - 4);
        return resZonePop(centre);
      }
      if (action === false && houses > 0) { this.removeHouse(x, y); return houses - 1; }
      return houses;
    }
    const density = Math.floor((id - RZB) / 9) % 4;
    const value = Math.floor((id - RZB) / 36);
    const action = this.decide(serviced, demand, DENSITY_GROW_P);
    if (action === true && wantCivic && density >= 1 && Math.random() < CIVIC_P) {
      // Micropolis sprinkles hospitals and churches into growing residential areas.
      plopZone(w, x, y, lotHash(x, y, 3) < 0.5 ? HOSPITALBASE : CHURCHBASE);
      return 0;
    }
    if (action === true && density < maxDensity('res', x, y) && density < this.resSmogCap(x, y)) {
      const centre = resBuildingCenter(density + 1, this.landValue(x, y));
      plopZone(w, x, y, centre - 4);
      return resZonePop(centre);
    }
    if (action === false) {
      if (density > 0) {
        const centre = resBuildingCenter(density - 1, value);
        plopZone(w, x, y, centre - 4);
        return resZonePop(centre);
      }
      // Lowest building -> back to an empty zone full of houses (Micropolis doResOut at pop 16).
      plopZone(w, x, y, RESBASE);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (dx || dy) w.set(x + dx, y + dy, (HOUSE + value * 3 + randInt(2)) | BLBNCNBIT | (w.get(x + dx, y + dy) & PWRBIT));
      }
      return 8;
    }
    return resZonePop(id);
  }

  private placeHouse(x: number, y: number, value: number): void {
    const w = this.world;
    const free: number[] = [];
    for (let k = 0; k < 9; k++) {
      if (k === 4) continue;
      const id = w.get(x + (k % 3) - 1, y + Math.floor(k / 3) - 1) & LOMASK;
      if (id >= RESBASE && id <= RESBASE + 8) free.push(k);
    }
    if (free.length === 0) return;
    const k = free[randInt(free.length - 1)];
    const hx = x + (k % 3) - 1, hy = y + Math.floor(k / 3) - 1;
    // Micropolis buildHouse: house id = HOUSE + value*3 + random(0..2)
    w.set(hx, hy, (HOUSE + value * 3 + randInt(2)) | BLBNCNBIT | (w.get(hx, hy) & PWRBIT));
  }

  private removeHouse(x: number, y: number): void {
    const w = this.world;
    const houses: number[] = [];
    for (let k = 0; k < 9; k++) {
      if (k !== 4 && isHouse(w.get(x + (k % 3) - 1, y + Math.floor(k / 3) - 1))) houses.push(k);
    }
    if (houses.length === 0) return;
    const k = houses[randInt(houses.length - 1)];
    const hx = x + (k % 3) - 1, hy = y + Math.floor(k / 3) - 1;
    w.set(hx, hy, (RESBASE + k) | BNCNBIT | (w.get(hx, hy) & PWRBIT));
  }

  // ---- commercial ----
  private stepCom(x: number, y: number, v: number, serviced: boolean, demand: number): number {
    const w = this.world;
    const id = v & LOMASK;
    const action = this.decide(serviced, demand, DENSITY_GROW_P);
    if (id === COMCLR) {
      if (action === true) {
        const centre = comBuildingCenter(0, this.landValue(x, y));
        plopZone(w, x, y, centre - 4);
        return comZonePop(centre);
      }
      return 0;
    }
    const density = Math.floor((id - CZB) / 9) % 5;
    const value = Math.floor((id - CZB) / 45);
    if (action === true && density < maxDensity('com', x, y)) {
      const centre = comBuildingCenter(density + 1, this.landValue(x, y));
      plopZone(w, x, y, centre - 4);
      return comZonePop(centre);
    }
    if (action === false) {
      if (density === 0) { plopZone(w, x, y, COMBASE); return 0; }
      const centre = comBuildingCenter(density - 1, value);
      plopZone(w, x, y, centre - 4);
      return comZonePop(centre);
    }
    return comZonePop(id);
  }

  // ---- industrial ----
  private stepInd(x: number, y: number, v: number, serviced: boolean, demand: number, cityPop: number): number {
    const w = this.world;
    const id = v & LOMASK;
    // Micropolis: industrial "value" is really city size; mix the two sprite sets per lot once the city is big.
    const value = cityPop > 500 && lotHash(x, y, 4) < 0.5 ? 1 : 0;
    const action = this.decide(serviced, demand, DENSITY_GROW_P);
    if (id === INDCLR) {
      if (action === true) {
        const centre = indBuildingCenter(0, value);
        plopZone(w, x, y, centre - 4);
        return indZonePop(centre);
      }
      return 0;
    }
    const density = Math.floor((id - IZB) / 9) % 4;
    if (action === true && density < maxDensity('ind', x, y)) {
      const centre = indBuildingCenter(density + 1, value);
      plopZone(w, x, y, centre - 4);
      return indZonePop(centre);
    }
    if (action === false) {
      if (density === 0) { plopZone(w, x, y, INDBASE); return 0; }
      const centre = indBuildingCenter(density - 1, value);
      plopZone(w, x, y, centre - 4);
      return indZonePop(centre);
    }
    return indZonePop(id);
  }
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 10000) / 10000;

const sum = (a: number[]): number => a.reduce((x, y) => x + y, 0);
const sortedKey = (ids: Set<string> | undefined): string => (ids && ids.size > 0 ? [...ids].sort().join(',') : '');
function addTo(m: Map<string, Set<string>>, k: string, v: string): void {
  let s = m.get(k);
  if (!s) { s = new Set(); m.set(k, s); }
  s.add(v);
}

/**
 * Split an integer `total` across `weights` proportionally (largest-remainder rounding).
 * Requires total <= sum(weights); then no share exceeds its weight.
 */
function apportion(total: number, weights: number[]): number[] {
  const w = sum(weights);
  if (total <= 0 || w <= 0) return weights.map(() => 0);
  const exact = weights.map((x) => (x * total) / w);
  const out = exact.map(Math.floor);
  let rem = total - sum(out);
  const order = exact.map((e, k) => k).sort((a, b) => (exact[b] - out[b]) - (exact[a] - out[a]));
  for (let k = 0; rem > 0 && k < order.length; k++, rem--) out[order[k]]++;
  return out;
}
