// Simulation: one tick = one game month, run for every active city (player with built tiles).
// Rules are a readable simplification of Micropolis (power scan, zone growth, RCI valves, taxes),
// plus cross-border power trading, fire (doFire/fireZone), neighbour and rail-link demand, and
// abandonment (idle cities decay to ruins and their plots are released).

import {
  WORLD_W, WORLD_H, CHUNK, TAX_RATE, COAL_POWER, NUCLEAR_POWER, POWER_PRICE_PER_UNIT,
  FIRE_SPREAD_P, FIRE_BURNOUT_P, FIRE_BURNOUT_P_COVERED, FIRE_STATION_RANGE, FIRE_OUTBREAK_BASE_P, FIRE_OWNER_ONLINE_MS,
  ABANDON_DECAY_DAYS, ABANDON_FREE_DAYS, ABANDON_DECAY_P, NEIGHBOUR_DEMAND_MAX, RAIL_LINK_BOOST, RAIL_LINK_MAX,
  HBRIDGE, VBRIDGE, HPOWER, VPOWER, HRAIL, VRAIL,
  LOMASK, ZONEBIT, CONDBIT, PWRBIT, ANIMBIT, BULLBIT, BURNBIT, BLBNCNBIT, BNCNBIT,
  DIRT, RUBBLE, FIRE, LASTFIRE, WOODS2, WOODS5, FOUNTAIN,
  FREEZ, RZB, HOUSE, RESBASE, COMCLR, CZB, COMBASE, INDCLR, IZB, INDBASE, POWERPLANT, FIRESTATION, HRAILROAD, VRAILROAD,
  resBuildingCenter, comBuildingCenter, indBuildingCenter, resZonePop, comZonePop, indZonePop, displayPopulation,
  isRoad, isRail, isWire, isTree, isWater, isIndZone, isComZone, isHouse, isZoneTile, parseChunkKey, inWorld, clamp,
  type ClaimInfo, type Demand, type GameTime,
} from '@globalcity/shared';
import { type World, chunkIndex, chunkCoords, type ChunkIndex } from './world.ts';
import type { Players, PlayerRecord } from './players.ts';
import { zoneKind, isPlantCenter, countHouses, plopZone, findZoneCenter } from './zones.ts';
import { fixZone } from './tools.ts';
import { chance, randInt, log } from './util.ts';

/** Tax multiplier: tuned so a town of ~20 full R, 8 C, 8 I zones earns ~$2600 per game year. */
const TAX_MULT = 0.45;
/** Growth odds per tick: one house step / one density step, scaled by demand (0..1). */
const HOUSE_GROW_P = 0.6;
const DENSITY_GROW_P = 0.25;
const NO_SERVICE_SHRINK_P = 1 / 8;
const NEG_DEMAND_SHRINK_P = 1 / 32;
const POWER_FILL_CAP = 200_000;
/** Random outbreak probability per city per tick never exceeds this, however big the city. */
const FIRE_OUTBREAK_MAX_P = 0.05;
/** Rail network BFS: total rail tiles visited per rebuild. */
const RAIL_FILL_CAP = 500_000;
/** A rail-linked city counts at least this fraction of RAIL_LINK_BOOST even while it has no population yet. */
const RAIL_LINK_MIN_SCALE = 0.1;
/** Displayed population at which a rail-linked city gives the full RAIL_LINK_BOOST. */
const RAIL_LINK_FULL_POP = 2000;

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
  /** tile index -> connected to some plant's grid */
  grid: Set<number>;
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

interface CityCounters { R: number; C: number; I: number; zones: number; rci: number; plants: number; supply: number; demand: number; stations: number }

const roadLike = (v: number): boolean => { const id = v & LOMASK; return isRoad(v) || id === HRAILROAD || id === VRAILROAD; };
const isFireTile = (v: number): boolean => { const id = v & LOMASK; return id >= FIRE && id <= LASTFIRE; };
const isParkTile = (v: number): boolean => { const id = v & LOMASK; return (id >= WOODS2 && id <= WOODS5) || id === FOUNTAIN; };
const rubbleTile = (): number => (RUBBLE + randInt(3)) | BULLBIT;
/** Tiles a rail network "serves": any multi-tile zone/building tile or a house. */
const zoneLike = (v: number): boolean => isZoneTile(v) || isHouse(v);
/** Built tiles that decay in an abandoned city (water-borne infrastructure is left alone). */
const decays = (v: number): boolean => {
  const id = v & LOMASK;
  if (id === HBRIDGE || id === VBRIDGE || id === HPOWER || id === VPOWER || id === HRAIL || id === VRAIL) return false;
  return isZoneTile(v) || isHouse(v) || isRoad(v) || isRail(v) || isWire(v) || isParkTile(v);
};
const fireTile = (): number => (FIRE + randInt(LASTFIRE - FIRE)) | ANIMBIT; // no BULLBIT/BURNBIT/CONDBIT: fire can't be dozed and breaks wires

export class Sim {
  tickCount = 0;
  private readonly randomFires: boolean;
  private readonly queue = new Int32Array(POWER_FILL_CAP + 4);
  private readonly lastPop = new Map<string, number>();
  /** fractional $ carried between ticks from power trading (like incomeAcc for taxes) */
  private readonly tradeAcc = new Map<string, number>();
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

  constructor(private readonly world: World, private readonly players: Players, opts: SimOptions = {}) {
    this.randomFires = opts.randomFires ?? true;
    this.seedFireChunks();
  }

  get time(): GameTime { return this.players.time; }

  tick(): TickResult {
    this.tickCount++;
    const t = this.players.time;
    t.month++;
    if (t.month >= 12) { t.month = 0; t.year++; }
    const newYear = t.month === 0;
    this.players.dirty = true;
    this.toasts = [];
    this.stations = [];

    // 0. Abandonment: idle owners' cities decay, then their plots are released.
    const now = Date.now();
    const unclaimed: { cx: number; cy: number }[] = [];
    const decaying = new Set<string>();
    const idleChanged = new Set<string>();
    for (const p of this.players.players.values()) {
      if (p.chunks.length === 0) { this.lastIdle.delete(p.id); continue; }
      const idle = this.players.idleDays(p, now);
      if (idle >= ABANDON_FREE_DAYS) {
        const released = this.players.release(p);
        unclaimed.push(...released);
        this.lastIdle.delete(p.id);
        this.lastPop.delete(p.id);
        log(`${p.name}'s city ${p.cityName || '(unnamed)'} abandoned for ${idle} days: released ${released.length} chunk(s)`);
        continue;
      }
      if (idle >= ABANDON_DECAY_DAYS) { decaying.add(p.id); this.decayStep(p); }
      if (this.lastIdle.get(p.id) !== idle) { this.lastIdle.set(p.id, idle); idleChanged.add(p.id); }
    }

    // 1. Neighbourhood: rail networks and neighbour/rail demand for every city with land.
    this.updateRailNetworks();
    for (const p of this.players.players.values()) if (p.chunks.length > 0) this.neighbourhoodStep(p, decaying);

    const cities = [...this.players.players.values()].filter((p) => p.active && p.chunks.length > 0);
    const power = this.powerScan(cities);
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
    this.fireStep();
    return { time: { ...t }, claimsChanged, toasts: this.toasts, unclaimed };
  }

  // -------------------------------------------------------------------------
  // 0. Abandonment: every built tile of a decaying city turns to rubble with ABANDON_DECAY_P per
  //    tick; a hit on a multi-tile building takes the whole footprint (like fireZone).
  // -------------------------------------------------------------------------
  private decayStep(p: PlayerRecord): void {
    const tiles = this.world.tiles;
    const hits: number[] = [];
    this.forEachChunkTile(p, (i) => { if (decays(tiles[i]) && chance(ABANDON_DECAY_P)) hits.push(i); });
    for (const i of hits) {
      const v = tiles[i];
      if (!decays(v)) continue; // already rubble from an earlier hit on the same building
      const x = i % WORLD_W, y = (i - x) / WORLD_W;
      this.ruin(x, y, v);
    }
  }

  /** Turn tile (x,y) (and the whole building it belongs to) into rubble. */
  private ruin(x: number, y: number, v: number): void {
    const w = this.world;
    const z = isZoneTile(v) ? findZoneCenter(w, x, y) : null;
    if (z) {
      for (let dy = 0; dy < z.size; dy++) for (let dx = 0; dx < z.size; dx++) w.set(z.cx - 1 + dx, z.cy - 1 + dy, rubbleTile());
      return;
    }
    w.set(x, y, rubbleTile());
    fixZone(w, x, y);
  }

  // -------------------------------------------------------------------------
  // 1. Neighbourhood. Neighbours (cities owning a chunk 8-adjacent to mine) add demand: their jobs
  //    attract my residents, their residents shop in my stores. Cities linked by rail to my zones add
  //    commercial (and half as much residential) demand. Decaying neighbours count for nothing.
  // -------------------------------------------------------------------------
  private neighbourhoodStep(p: PlayerRecord, decaying: Set<string>): void {
    const s = p.stats;
    const nb = this.players.neighboursOf(p);
    let jobs = 0, R = 0;
    for (const id of nb) {
      const q = this.players.players.get(id);
      if (!q || decaying.has(id)) continue;
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
      if (!q || q.chunks.length === 0 || decaying.has(id)) continue;
      rail += RAIL_LINK_BOOST * clamp(q.stats.population / RAIL_LINK_FULL_POP, RAIL_LINK_MIN_SCALE, 1);
    }
    s.railLinks = linked.size;
    s.railDemand = round4(Math.min(RAIL_LINK_MAX, rail));
  }

  /**
   * Rebuild rail networks if a rail/zone tile or the claims changed: BFS over 4-adjacent rail tiles
   * (crossings included) seeded from rail in claimed chunks, capped at RAIL_FILL_CAP tiles in total.
   * A city is "on" a network when a network tile touches one of its zone tiles or houses.
   */
  private updateRailNetworks(): void {
    const w = this.world;
    if (!w.railDirty && this.railVersion === this.players.claimsVersion) return;
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
  private powerScan(cities: PlayerRecord[]): PowerScan {
    const tiles = this.world.tiles;
    const grid = new Set<number>();
    const brownout = new Set<number>();
    const queue = this.queue;
    const book: TradeBook = { net: new Map(), spent: new Map(), buyFrom: new Map(), sellTo: new Map() };
    for (const p of cities) { p.stats.powerImported = 0; p.stats.powerExported = 0; p.stats.powerTradeNet = 0; }

    const fill = (start: number): void => {
      const plants: number[] = [];
      const zones: number[] = [];
      let head = 0, tail = 0;
      queue[tail++] = start;
      grid.add(start);
      while (head < tail) {
        const i = queue[head++];
        const v = tiles[i];
        if (v & ZONEBIT) {
          if (isPlantCenter(v)) plants.push(i);
          else zones.push(i);
        }
        if (tail >= POWER_FILL_CAP) continue;
        const x = i % WORLD_W, y = (i - x) / WORLD_W;
        const tryPush = (j: number): void => {
          if (!grid.has(j) && (tiles[j] & CONDBIT)) { grid.add(j); queue[tail++] = j; }
        };
        if (y > 0) tryPush(i - WORLD_W);
        if (x < WORLD_W - 1) tryPush(i + 1);
        if (y < WORLD_H - 1) tryPush(i + WORLD_W);
        if (x > 0) tryPush(i - 1);
      }
      this.settleGrid(plants, zones, brownout, book);
    };

    // Seed fills from every plant in every active city.
    for (const p of cities) {
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
    // Settle money (fractional accumulator) and announce new trade relationships.
    for (const p of cities) {
      const net = book.net.get(p.id) ?? 0;
      if (net !== 0) {
        let acc = (this.tradeAcc.get(p.id) ?? 0) + net;
        const whole = Math.trunc(acc);
        acc -= whole;
        this.tradeAcc.set(p.id, acc);
        p.funds += whole;
        p.stats.powerTradeNet = Math.round(net);
      }
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
      if (c) c.supply += (tiles[i] & LOMASK) === POWERPLANT ? COAL_POWER : NUCLEAR_POWER;
    }
    for (const i of zones) {
      const c = cityOf(i);
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
    const c: CityCounters = { R: 0, C: 0, I: 0, zones: 0, rci: 0, plants: 0, supply: 0, demand: 0, stations: 0 };
    const demand = p.stats.demand;
    const cityPop = p.stats.population;

    this.forEachChunkTile(p, (i, x, y) => {
      const v = tiles[i];
      if ((v & ZONEBIT) === 0) return;
      const kind = zoneKind(v);
      if (kind === 'coal') { c.plants++; c.supply += COAL_POWER; return; }
      if (kind === 'nuclear') { c.plants++; c.supply += NUCLEAR_POWER; return; }
      c.zones++;
      if (power.grid.has(i)) c.demand++;
      if (kind === 'other') {
        if ((v & LOMASK) === FIRESTATION && (v & PWRBIT)) { c.stations++; this.stations.push(i); }
        return;
      }
      c.rci++;
      const powered = (v & PWRBIT) !== 0;
      const road = this.hasRoadAccess(x, y);
      switch (kind) {
        case 'res': c.R += this.stepRes(x, y, v, powered && road, demand.r); break;
        case 'com': c.C += this.stepCom(x, y, v, powered && road, demand.c); break;
        case 'ind': c.I += this.stepInd(x, y, v, powered && road, demand.i, cityPop); break;
      }
    });

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
    const nd = p.stats.neighbourDemand, rail = p.stats.railDemand;
    r = clamp(r + nd.r + rail / 2, -1, 1);
    cd = clamp(cd + nd.c + rail, -1, 1);
    id = clamp(id + nd.i, -1, 1);
    const newDemand: Demand = { r: round2(r), c: round2(cd), i: round2(id) };

    // 4. Taxes: monthly share of yearly tax on the weighted population, fractional accumulator.
    p.incomeAcc += ((c.R + jobs) * TAX_RATE / 12) * TAX_MULT;
    const gained = Math.floor(p.incomeAcc);
    if (gained > 0) {
      p.incomeAcc -= gained;
      p.funds += gained;
      p.yearIncome += gained;
    }
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

    // 6. Random fire outbreak: p = BASE * sqrt(zones/30), capped; bigger cities burn more often.
    // Only while the owner is around (every client message touches lastSeen; pings every 20 s).
    if (this.randomFires && c.rci > 0 && Date.now() - p.lastSeen < FIRE_OWNER_ONLINE_MS) {
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
    if (isZoneTile(v)) {
      const z = findZoneCenter(w, x, y);
      if (z) {
        for (let dy = 0; dy < z.size; dy++) {
          for (let dx = 0; dx < z.size; dx++) {
            const tx = z.cx - 1 + dx, ty = z.cy - 1 + dy;
            if (tx !== x || ty !== y) w.set(tx, ty, rubbleTile());
          }
        }
      }
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
      if (isZoneTile(v) || isHouse(v)) preferred.push(i); else other.push(i);
    });
    const pool = preferred.length > 0 ? preferred : other;
    if (pool.length === 0) return;
    const i = pool[randInt(pool.length - 1)];
    const x = i % WORLD_W, y = (i - x) / WORLD_W;
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
      if (!this.players.ownerOf(Math.floor(x / CHUNK), Math.floor(y / CHUNK))) return; // no wildfires on unclaimed land
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
  private hasRoadAccess(x: number, y: number): boolean {
    const w = this.world;
    for (let dy = -3; dy <= 3; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= WORLD_H) continue;
      for (let dx = -3; dx <= 3; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= WORLD_W) continue;
        if (roadLike(w.get(xx, yy))) return true;
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
    for (let dy = -12; dy <= 12 && !industry; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= WORLD_H) continue;
      for (let dx = -12; dx <= 12; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= WORLD_W) continue;
        const v = w.get(xx, yy);
        if (isIndZone(v)) { industry = true; break; }
        if (!commerce && Math.abs(dx) <= 8 && Math.abs(dy) <= 8 && isComZone(v)) commerce = true;
      }
    }
    if (!industry) value++;
    if (commerce) value++;
    return clamp(value, 0, 3);
  }

  // ---- residential ----
  private stepRes(x: number, y: number, v: number, serviced: boolean, demand: number): number {
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
    if (action === true && density < 3) {
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
    if (action === true && density < 4) {
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
    const value = cityPop > 500 ? 1 : 0; // Micropolis: industrial "value" is really city size
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
    if (action === true && density < 3) {
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
