// Players and chunk claims. Each player is one "city" = the union of their claimed chunks.

import crypto from 'node:crypto';
import {
  STARTING_FUNDS, ABANDON_RECLAIM_DAYS, MAX_MAYOR_NAME, MAX_CITY_NAME, claimCost, minLandToClaim, MIN_LAND_TILES_FIRST_CLAIM, CHUNKS_X, CHUNKS_Y, CHUNK, MAX_CHUNKS_PER_PLAYER, WORLD_W, ZONEBIT,
  chunkKey, parseChunkKey, colorForId,
  type PlayerStats, type PlayerPublic, type ClaimInfo, type GameTime, START_YEAR, type BudgetYear, BUDGET_YEARS_SENT,
  type IncomeLine, type ExpenseLine, type MoneyLine, INCOME_LINES, EXPENSE_LINES, emptyBudgetYear,
  MILESTONE_BUILDINGS, milestoneUnlocksFor, nextMilestone,
  LIFELINE_MAX_FUNDS, LIFELINE_REPAY_SHARE, LIFELINE_AMOUNT, LIFELINE_EARLY_PEAK_POP, LIFELINE_MAX_DEBT,
} from '@globalcity/shared';
import { World, validChunk } from './world.ts';
import type { Places } from './places.ts';

export interface PlayerRecord {
  id: string;
  /** highest displayed population reached; milestones are earned from it */
  peakPop?: number;
  /** milestone buildings the city already had before milestones existed (unlocked without reaching the milestone) */
  grandfathered?: string[];
  /** milestone unlocks the mayor has been told about */
  announced?: string[];
  /** lifeline still owed */
  debt?: number;
  /** the city's rail has reached another mayor's city at least once (unlocks Grand Central for good) */
  railLinked?: boolean;
  /** set by the admin: the mayor and city names can no longer be changed by the player */
  namesLocked?: boolean;
  /** a retired city kept as a monument (a record of its own, no player behind it): frozen, never released */
  monument?: { at: number; population: number; founderId: string };
  /** plots this mayor left by abandoning their city, which they can't claim again until `until` */
  leftPlots?: { keys: string[]; until: number };
  /** message shown to the player on their next visit (e.g. why their plot was released), then cleared */
  notice?: string;
  token: string; // secret, never sent except in 'welcome' to its owner
  name: string;
  /** city name: '' until the first claim, then defaulted from the nearest populated place; kept when claims are released */
  cityName: string;
  color: string;
  funds: number;
  chunks: string[]; // chunk keys "cx,cy"
  stats: PlayerStats;
  createdAt: number;
  lastSeen: number;
  /** when a natural disaster last struck the city (ms epoch); at most one an hour */
  lastDisaster?: number;
  /** city participates in the simulation (has built something; cleared when no zones/plants remain) */
  active: boolean;
  /** fraction of a dollar carried between ledger moves (funds only move in whole dollars) */
  fundsCarry?: number;
  /** operating result so far this game year, whole dollars actually moved (the sidebar's "last year") */
  /** money made since the last game month began (shown as last month's income) */
  yearIncome: number;
  /** the current game year's money so far, by budget line (fractional; rounded into the stats) */
  yearBook?: YearBook;
  /** completed years, oldest first, at most BUDGET_HISTORY years (for the budget screen and any future graphs) */
  budgetHistory?: BudgetYear[];
}

export type YearBook = Record<MoneyLine, number>;
export const BUDGET_HISTORY = 100;
export function emptyYearBook(): YearBook {
  const { year: _y, ...lines } = emptyBudgetYear(0);
  return lines;
}
/** The running year book, created on first use. */
export const bookOf = (p: PlayerRecord): YearBook => (p.yearBook ??= emptyYearBook());
export function roundedYear(book: YearBook, year: number): BudgetYear {
  const y = emptyBudgetYear(year);
  for (const k of [...INCOME_LINES, ...EXPENSE_LINES]) y[k] = Math.round(book[k]);
  return y;
}
/** Close the game year `year` for a player: file it in the history and start a fresh book. */
export function closeYear(p: PlayerRecord, year: number): void {
  const h = (p.budgetHistory ??= []);
  h.push(roundedYear(bookOf(p), year));
  if (h.length > BUDGET_HISTORY) h.splice(0, h.length - BUDGET_HISTORY);
  p.yearBook = emptyYearBook();
}
/** The stats' view of the budget: the year so far plus the last few completed years. */
export function budgetStats(p: PlayerRecord, year: number): PlayerStats['budget'] {
  return { current: roundedYear(bookOf(p), year), years: (p.budgetHistory ?? []).slice(-BUDGET_YEARS_SENT) };
}

/**
 * The ledger: the only way money enters or leaves a city. Every caller names the budget line, so the
 * books always add up. Amounts are >= 0 and may be fractional (monthly shares of yearly figures):
 * funds move in whole dollars through a carried fraction. Funds never go below $0. Both return the
 * whole dollars actually moved. The only things that set funds outright are a fresh start and the
 * dev/test hook.
 */
export function earn(p: PlayerRecord, line: IncomeLine, amount: number): number { return move(p, line, amount); }
export function spend(p: PlayerRecord, line: ExpenseLine, amount: number): number { return -move(p, line, -amount); }
function move(p: PlayerRecord, line: MoneyLine, signed: number): number {
  if (!(Math.abs(signed) > 0)) return 0; // nothing, or NaN
  bookOf(p)[line] += Math.abs(signed);
  const acc = (p.fundsCarry ?? 0) + signed;
  const whole = Math.trunc(acc);
  p.fundsCarry = acc - whole;
  const before = p.funds;
  p.funds = Math.max(0, p.funds + whole);
  p.stats.funds = p.funds;
  refreshLifeline(p);
  return p.funds - before;
}

export interface StateFile {
  version: 1;
  time: GameTime;
  players: PlayerRecord[];
  claims: [string, string][]; // chunkKey -> playerId
  /** Older saves: released plots that were still crumbling. Nothing decays any more; ignored on load. */
  ruins?: string[];
}

/** `inherited`: zones and buildings already standing on the plot (left by an earlier city), now the claimant's. */
export type ClaimResult = { ok: true; cost: number; inherited: number } | { ok: false; msg: string };

const FIND_FREE_MAX_RADIUS = 40;

export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const s = raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, MAX_MAYOR_NAME);
  return s.length > 0 ? s : null;
}


export function sanitizeCityName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const s = raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_CITY_NAME).trim();
  return s.length > 0 ? s : null;
}

export interface PlayersOptions {
  /** length of an abandonment "day" in ms (default 86400000; tests shorten it) */
  dayMs?: number;
}

export function emptyStats(funds: number): PlayerStats {
  return {
    funds, population: 0, resPop: 0, comPop: 0, indPop: 0,
    powerSupply: 0, powerDemand: 0, demand: { r: 0, c: 0, i: 0 }, chunks: 0, lastIncome: 0,
    powerImported: 0, powerExported: 0, powerTradeNet: 0,
    fires: 0, fireStations: 0,
    neighbours: 0, neighbourDemand: { r: 0, c: 0, i: 0 }, railLinks: 0, railDemand: 0,
    crime: 0, policeStations: 0, specials: { stadium: 0, seaport: 0, airport: 0 }, traffic: 0,
    peakPop: 0, nextMilestone: MILESTONE_BUILDINGS.cityhall.pop, unlocked: [], built: {}, cityHall: 0,
    debt: 0, lifelineAvailable: false,
    budget: { current: emptyBudgetYear(START_YEAR), years: [] },
  };
}

export const NAMES_LOCKED_MSG = 'Your mayor and city names have been set by the admin and can no longer be changed';

/** Milestone buildings this player may build: reached by peak population, plus grandfathered. */
export function unlockedOf(p: PlayerRecord): string[] {
  return [...new Set([...milestoneUnlocksFor(p.peakPop ?? 0), ...(p.grandfathered ?? []), ...(p.railLinked ? ['grandcentral'] : [])])];
}

/** Recompute the milestone part of a player's stats from their record. */
export function refreshMilestoneStats(p: PlayerRecord): void {
  const peak = p.peakPop ?? 0;
  const s = p.stats;
  s.peakPop = peak;
  s.nextMilestone = nextMilestone(peak)?.pop ?? null;
  s.unlocked = unlockedOf(p);
  refreshLifeline(p);
}

/**
 * A lifeline is repaid from surplus months only: a share (LIFELINE_REPAY_SHARE, at least $1) of the
 * month's operating result, until cleared; loss months leave the debt alone.
 */
export function repayLifeline(p: PlayerRecord, monthNet: number): { repaid: number; cleared: boolean } {
  if (monthNet <= 0 || (p.debt ?? 0) <= 0) return { repaid: 0, cleared: false };
  const repaid = Math.min(p.debt!, Math.max(1, Math.ceil(monthNet * LIFELINE_REPAY_SHARE)));
  p.debt = p.debt! - repaid;
  spend(p, 'repaid', repaid);
  const cleared = p.debt <= 0;
  if (cleared) p.debt = 0;
  refreshLifeline(p);
  return { repaid, cleared };
}

/** Lifeline status in stats: what is owed, and whether a new lifeline can be taken now. */
export function refreshLifeline(p: PlayerRecord): void {
  p.stats.debt = p.debt ?? 0;
  p.stats.lifelineAvailable = p.chunks.length > 0 && p.funds < LIFELINE_MAX_FUNDS && lifelineDebtOk(p);
}

/** Debt rule for a new lifeline: nothing owed, or an early city that stays within LIFELINE_MAX_DEBT. */
export function lifelineDebtOk(p: PlayerRecord): boolean {
  const debt = p.debt ?? 0;
  if (debt <= 0) return true;
  return (p.peakPop ?? 0) < LIFELINE_EARLY_PEAK_POP && debt + LIFELINE_AMOUNT <= LIFELINE_MAX_DEBT;
}

export class Players {
  readonly players = new Map<string, PlayerRecord>();
  readonly claims = new Map<string, string>();
  time: GameTime = { year: START_YEAR, month: 0, step: 0 };
  /** state changed since last save */
  dirty = false;
  /** bumped whenever the claims map changes (consumers cache per version: neighbours, rail networks) */
  claimsVersion = 0;
  readonly dayMs: number;
  private neighbourCache = new Map<string, Set<string>>();
  private neighbourCacheVersion = -1;

  constructor(private readonly world: World, private readonly places: Places, opts: PlayersOptions = {}) {
    this.dayMs = opts.dayMs ?? 86_400_000;
  }

  create(name?: string | null): PlayerRecord {
    const id = crypto.randomUUID();
    const now = Date.now();
    const p: PlayerRecord = {
      id,
      token: crypto.randomBytes(16).toString('hex'),
      name: name ?? `Mayor-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
      cityName: '',
      color: colorForId(id),
      funds: STARTING_FUNDS,
      chunks: [],
      stats: emptyStats(STARTING_FUNDS),
      createdAt: now,
      lastSeen: now,
      active: false,
      yearIncome: 0,
    };
    this.players.set(id, p);
    this.dirty = true;
    return p;
  }

  resume(id: unknown, token: unknown): PlayerRecord | null {
    if (typeof id !== 'string' || typeof token !== 'string') return null;
    const p = this.players.get(id);
    if (!p || p.token !== token) return null;
    p.lastSeen = Date.now();
    this.dirty = true;
    return p;
  }

  /** Rename the mayor; false when the admin has locked this player's names. */
  rename(p: PlayerRecord, name: string): boolean {
    if (p.namesLocked) return false;
    p.name = name;
    this.dirty = true;
    return true;
  }

  /** Mark the player as seen now (any message from their socket). */
  touch(p: PlayerRecord): void {
    p.lastSeen = Date.now();
    this.dirty = true;
  }

  /** Whole days since the owner was last seen (0 while online, since every message touches lastSeen). */
  idleDays(p: PlayerRecord, now = Date.now()): number {
    return Math.max(0, Math.floor((now - p.lastSeen) / this.dayMs));
  }

  // ---- city names ----

  /** True if another player (not `except`) already uses this city name (case-insensitive). */
  cityNameTaken(name: string, except?: PlayerRecord): boolean {
    const key = name.toLowerCase();
    for (const q of this.players.values()) if (q !== except && q.cityName.toLowerCase() === key) return true;
    return false;
  }

  /** `name`, else "New name", else "name 2", "name 3", ... whichever is free. */
  private uniqueCityName(name: string, except?: PlayerRecord): string {
    if (!this.cityNameTaken(name, except)) return name;
    const alt = `New ${name}`.slice(0, MAX_CITY_NAME).trim();
    if (!this.cityNameTaken(alt, except)) return alt;
    for (let n = 2; ; n++) {
      const suffix = ` ${n}`;
      const cand = `${name.slice(0, MAX_CITY_NAME - suffix.length)}${suffix}`;
      if (!this.cityNameTaken(cand, except)) return cand;
    }
  }

  /** Default city name for a city founded on chunk (cx,cy): nearest populated place, made unique. */
  defaultCityName(cx: number, cy: number, except?: PlayerRecord): string {
    const x = cx * CHUNK + CHUNK / 2, y = cy * CHUNK + CHUNK / 2;
    const base = this.places.nearestName(x, y) ?? `Settlement ${cx},${cy}`;
    return this.uniqueCityName(sanitizeCityName(base) ?? `Settlement ${cx},${cy}`, except);
  }

  renameCity(p: PlayerRecord, name: string): { ok: true } | { ok: false; msg: string } {
    if (p.namesLocked) return { ok: false, msg: NAMES_LOCKED_MSG };
    if (this.cityNameTaken(name, p)) return { ok: false, msg: `There is already a city called ${name}` };
    p.cityName = name;
    this.dirty = true;
    return { ok: true };
  }

  publicOf(p: PlayerRecord): PlayerPublic {
    return { id: p.id, name: p.name, color: p.color, cityName: p.cityName };
  }

  ownerOf(cx: number, cy: number): PlayerRecord | undefined {
    const id = this.claims.get(chunkKey(cx, cy));
    return id === undefined ? undefined : this.players.get(id);
  }

  ownsChunk(p: PlayerRecord, cx: number, cy: number): boolean {
    return this.claims.get(chunkKey(cx, cy)) === p.id;
  }

  /** Unclaimed and at least `minLand` land tiles (defaults to the stricter founding-plot rule). */
  isClaimable(cx: number, cy: number, minLand = MIN_LAND_TILES_FIRST_CLAIM): boolean {
    return validChunk(cx, cy) && !this.claims.has(chunkKey(cx, cy)) && this.world.hasEnoughLand(cx, cy, minLand);
  }

  /**
   * Claim a chunk. The first claim is free; later ones cost claimCost(owned) (escalating) and must be
   * 4-adjacent to a chunk the player already owns. Whatever stands on a released plot comes with it, as it is
   * and at no extra cost; the city starts simulating right away if that includes a zone or building.
   */
  claim(p: PlayerRecord, cx: number, cy: number): ClaimResult {
    if (!validChunk(cx, cy)) return { ok: false, msg: 'Invalid chunk' };
    const key = chunkKey(cx, cy);
    if (this.claims.has(key)) {
      return { ok: false, msg: this.claims.get(key) === p.id ? 'You already own this chunk' : 'Chunk already claimed' };
    }
    if (p.leftPlots && Date.now() >= p.leftPlots.until) { delete p.leftPlots; this.dirty = true; }
    if (p.leftPlots?.keys.includes(key)) {
      const days = Math.max(1, Math.ceil((p.leftPlots.until - Date.now()) / this.dayMs));
      return { ok: false, msg: `You left this plot when you abandoned your city: you can claim it again in ${days} ${days === 1 ? 'day' : 'days'}. Start your new city somewhere else.` };
    }
    const minLand = minLandToClaim(p.chunks.length);
    if (!this.world.hasEnoughLand(cx, cy, minLand)) {
      const land = this.world.landCount(cx, cy).toLocaleString('en-US');
      return {
        ok: false,
        msg: p.chunks.length === 0
          ? `Not enough land here to found a city: a first plot needs at least ${minLand.toLocaleString('en-US')} land tiles, this one has ${land}. Try "Find nearest free plot".`
          : `Not enough land here: a plot needs at least ${minLand.toLocaleString('en-US')} land tiles, this one has ${land}`,
      };
    }
    if (p.chunks.length >= MAX_CHUNKS_PER_PLAYER) return { ok: false, msg: `Your city is at the maximum of ${MAX_CHUNKS_PER_PLAYER} plots` };
    let cost = 0;
    if (p.chunks.length > 0) {
      const adjacent = p.chunks.some((k) => {
        const c = parseChunkKey(k);
        return Math.abs(c.cx - cx) + Math.abs(c.cy - cy) === 1;
      });
      if (!adjacent) return { ok: false, msg: 'New chunks must be adjacent to your city' };
      cost = claimCost(p.chunks.length);
      if (p.funds < cost) return { ok: false, msg: `Not enough funds (plot #${p.chunks.length + 1} costs $${cost.toLocaleString('en-US')})` };
    }
    if (cost > 0) spend(p, 'plots', cost);
    if (p.chunks.length === 0 && !p.cityName) p.cityName = this.defaultCityName(cx, cy, p);
    p.chunks.push(key);
    p.stats.chunks = p.chunks.length;
    p.stats.funds = p.funds;
    this.claims.set(key, p.id);
    const inherited = this.zoneCentres(cx, cy);
    if (inherited > 0) p.active = true;
    this.claimsVersion++;
    this.dirty = true;
    return { ok: true, cost, inherited };
  }

  /** Zones and buildings (their centre tiles) standing in a chunk. */
  private zoneCentres(cx: number, cy: number): number {
    const t = this.world.tiles;
    let n = 0;
    for (let dy = 0; dy < CHUNK; dy++) {
      const row = (cy * CHUNK + dy) * WORLD_W + cx * CHUNK;
      for (let dx = 0; dx < CHUNK; dx++) if (t[row + dx] & ZONEBIT) n++;
    }
    return n;
  }

  /**
   * Retire p's city as a monument: a new record (same mayor name, city name and colour, the city's stats as they
   * are now) takes over every plot and is frozen forever; p starts over with a fresh, empty account (starting
   * funds, no plots, no unlocks, no debt) and claims a new first plot like a new player. Returns the monument.
   */
  /**
   * Abandon p's city: every plot is released as it stands, for anyone to claim with its buildings; p starts over
   * like a new mayor (starting funds, lifeline debt written off, no unlocks) and can't claim those plots back for
   * ABANDON_RECLAIM_DAYS. Returns the plots.
   */
  abandon(p: PlayerRecord): { cx: number; cy: number }[] {
    p.leftPlots = { keys: [...p.chunks], until: Date.now() + ABANDON_RECLAIM_DAYS * this.dayMs };
    const released = this.release(p);
    this.resetForFreshStart(p);
    return released;
  }

  /** A mayor starting over: starting funds, no plots, no city name, no debt, milestones from zero. */
  private resetForFreshStart(p: PlayerRecord): void {
    p.chunks = [];
    p.cityName = '';
    p.funds = STARTING_FUNDS;
    p.debt = 0;
    p.peakPop = 0;
    p.grandfathered = [];
    p.announced = [];
    p.railLinked = false;
    p.active = false;
    p.fundsCarry = 0;
    p.yearIncome = 0;
    delete p.yearBook;
    delete p.budgetHistory;
    p.stats = emptyStats(STARTING_FUNDS);
    this.dirty = true;
  }

  makeMonument(p: PlayerRecord): PlayerRecord {
    const now = Date.now();
    const m = this.create(p.name);
    Object.assign(m, {
      cityName: p.cityName, color: p.color, funds: p.funds, chunks: [...p.chunks], stats: { ...p.stats },
      peakPop: p.peakPop, grandfathered: p.grandfathered, announced: p.announced, railLinked: p.railLinked,
      namesLocked: true, createdAt: p.createdAt, lastSeen: now,
      monument: { at: now, population: p.stats.population, founderId: p.id },
    });
    m.token = crypto.randomBytes(16).toString('hex'); // nobody can log in as a monument
    for (const key of m.chunks) this.claims.set(key, m.id);
    this.resetForFreshStart(p);
    this.claimsVersion++;
    this.dirty = true;
    return m;
  }

  /**
   * Release every claim of an abandoned city. The player keeps funds and city name; stats reset to
   * an empty city. Tiles are left as they are: the next claimant gets them. Returns the released chunks.
   */
  release(p: PlayerRecord): { cx: number; cy: number }[] {
    const out: { cx: number; cy: number }[] = [];
    for (const key of p.chunks) {
      if (this.claims.get(key) === p.id) this.claims.delete(key);
      out.push(parseChunkKey(key));
    }
    p.chunks = [];
    p.active = false;
    p.fundsCarry = 0;
    p.yearIncome = 0;
    p.stats = emptyStats(p.funds);
    if (out.length > 0) this.claimsVersion++;
    this.dirty = true;
    return out;
  }

  // ---- neighbours: other players owning a chunk 8-adjacent to one of mine (cached per claimsVersion) ----

  neighboursOf(p: PlayerRecord): Set<string> {
    if (this.neighbourCacheVersion !== this.claimsVersion) { this.neighbourCache.clear(); this.neighbourCacheVersion = this.claimsVersion; }
    let s = this.neighbourCache.get(p.id);
    if (s) return s;
    s = new Set();
    for (const key of p.chunks) {
      const { cx, cy } = parseChunkKey(key);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const id = this.claims.get(chunkKey(cx + dx, cy + dy));
          if (id !== undefined && id !== p.id) s.add(id);
        }
      }
    }
    this.neighbourCache.set(p.id, s);
    return s;
  }

  /** Nearest chunk a new mayor could found a city on (unclaimed, founding-plot land rule) to (cx,cy), by expanding
   *  square rings; null if none within the radius cap. */
  findFree(cx: number, cy: number): { cx: number; cy: number } | null {
    cx = Math.min(Math.max(Math.round(cx), 0), CHUNKS_X - 1);
    cy = Math.min(Math.max(Math.round(cy), 0), CHUNKS_Y - 1);
    if (this.isClaimable(cx, cy)) return { cx, cy };
    for (let r = 1; r <= FIND_FREE_MAX_RADIUS; r++) {
      let best: { cx: number; cy: number; d: number } | null = null;
      for (let dy = -r; dy <= r; dy++) {
        const edgeRow = Math.abs(dy) === r;
        for (let dx = -r; dx <= r; dx += edgeRow ? 1 : 2 * r) {
          const x = cx + dx, y = cy + dy;
          if (!validChunk(x, y) || !this.isClaimable(x, y)) continue;
          const d = dx * dx + dy * dy;
          if (!best || d < best.d) best = { cx: x, cy: y, d };
        }
      }
      if (best) return { cx: best.cx, cy: best.cy };
    }
    return null;
  }

  claimInfo(cx: number, cy: number, p: PlayerRecord, now = Date.now()): ClaimInfo {
    const info: ClaimInfo = { cx, cy, ownerId: p.id, ownerName: p.name, cityName: p.cityName, color: p.color, pop: p.stats.population, idleDays: p.monument ? 0 : this.idleDays(p, now) };
    if (p.monument) info.monument = true;
    return info;
  }

  claimInfosOf(p: PlayerRecord): ClaimInfo[] {
    const now = Date.now();
    return p.chunks.map((k) => { const c = parseChunkKey(k); return this.claimInfo(c.cx, c.cy, p, now); });
  }

  allClaims(): ClaimInfo[] {
    const out: ClaimInfo[] = [];
    const now = Date.now();
    for (const [key, id] of this.claims) {
      const p = this.players.get(id);
      if (!p) continue;
      const c = parseChunkKey(key);
      out.push(this.claimInfo(c.cx, c.cy, p, now));
    }
    return out;
  }

  serialize(): StateFile {
    return { version: 1, time: { ...this.time }, players: [...this.players.values()], claims: [...this.claims.entries()] };
  }

  /** Load a state file; players saved by older versions get the new fields (cityName derived from their first chunk, lastSeen = now). */
  load(state: StateFile): void {
    this.time = { step: 0, ...state.time };
    const now = Date.now();
    const unnamed: PlayerRecord[] = [];
    for (const raw of state.players) {
      const legacy = raw as Partial<PlayerRecord>;
      const stats = { ...emptyStats(raw.funds), ...raw.stats };
      stats.neighbourDemand = { ...emptyStats(0).neighbourDemand, ...(raw.stats?.neighbourDemand ?? {}) };
      stats.specials = { ...emptyStats(0).specials, ...(raw.stats?.specials ?? {}) };
      stats.unlocked = Array.isArray(raw.stats?.unlocked) ? raw.stats.unlocked : [];
      stats.built = { ...(raw.stats?.built ?? {}) };
      if (!raw.stats?.budget?.current) stats.budget = emptyStats(0).budget;
      const p: PlayerRecord = {
        ...raw,
        cityName: typeof legacy.cityName === 'string' ? legacy.cityName : '',
        lastSeen: typeof legacy.lastSeen === 'number' && Number.isFinite(legacy.lastSeen) ? legacy.lastSeen : now,
        chunks: Array.isArray(raw.chunks) ? raw.chunks : [],
        stats,
      };
      p.stats.funds = p.funds;
      p.stats.chunks = p.chunks.length;
      if (p.yearBook && typeof p.yearBook.taxes !== 'number' || (p.yearBook as unknown as { upkeep?: unknown })?.upkeep !== undefined) delete p.yearBook; // older book shapes
      if (!Array.isArray(p.budgetHistory)) delete p.budgetHistory;
      this.players.set(p.id, p);
      if (!p.cityName && p.chunks.length > 0) unnamed.push(p);
    }
    for (const [key, id] of state.claims) if (this.players.has(id)) this.claims.set(key, id);
    for (const p of unnamed) {
      const c = parseChunkKey(p.chunks[0]);
      p.cityName = this.defaultCityName(c.cx, c.cy, p);
      this.dirty = true;
    }
    this.claimsVersion++;
  }
}
