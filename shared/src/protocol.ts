import type { ActiveDisaster } from './disasters.ts';
import type { ToolId } from './tools.ts';
import type { AirportInfo } from './flights.ts';
import type { PortInfo, SeaRoute } from './ships.ts';
import type { CustomBuilding } from './tools.ts';
import { CHUNK } from './constants.ts';

export interface PlayerPublic {
  id: string;
  name: string; // mayor name
  color: string; // css hex
  cityName: string; // '' until the first claim; defaulted from the nearest Natural Earth populated place
}

export interface ClaimInfo {
  cx: number;
  cy: number;
  ownerId: string;
  ownerName: string;
  cityName: string;
  color: string;
  pop: number; // displayed population of the whole city this chunk belongs to
  idleDays: number; // days since the owner was last seen; >= ABANDON_IDLE_DAYS means abandoned, claims released at ABANDON_FREE_DAYS
  /** a retired city kept as a monument: frozen, never released (absent = a normal city) */
  monument?: boolean;
}

/** The whole planet at a glance (the world stats dialog). Counted over every claimed plot, refreshed every 30 s. */
export interface WorldStats {
  year: number;
  /** people in every city combined (monuments not included) */
  population: number;
  /** cities with land (not monuments) */
  cities: number;
  monuments: number;
  /** cities whose mayor has been away more than 30 days */
  abandoned: number;
  /** mayors playing right now */
  online: number;
  /** plots claimed, and plots with enough land to claim in the whole world */
  plots: number;
  landPlots: number;
  biggest: { name: string; population: number; cx: number; cy: number } | null;
  /** the city of the mayor who joined last */
  newest: { name: string; at: number; cx: number; cy: number } | null;
  /** tiles of road (incl. traffic), rail and power line, and zones built, across every city */
  roads: number;
  rail: number;
  powerLines: number;
  zones: { res: number; com: number; ind: number };
  /** power plants and the power they supply */
  plants: number;
  powerSupply: number;
  airports: number;
  seaports: number;
  seaRoutes: number;
  /** disasters in the last 24 hours, by kind (Disaster), and those on the go */
  disasters: number[];
  activeDisasters: number;
  /** claimed plots by their commonest biome (Biome) */
  biomes: number[];
}

export interface GameTime {
  year: number;
  month: number; // 0..11
  /** simulation steps into the month (0..STEPS_PER_MONTH-1); absent in saves from before the slower calendar */
  step?: number;
}

export interface Demand { r: number; c: number; i: number } // -1..1

export interface PlayerStats {
  funds: number;
  population: number;
  resPop: number;
  comPop: number;
  indPop: number;
  powerSupply: number; // zone-units available
  powerDemand: number; // zone-units needed
  demand: Demand;
  chunks: number; // chunks owned
  lastIncome: number; // funds gained last game month
  // Power trading (per simulation step)
  powerImported: number; // zone-units bought from neighbours' grids
  powerExported: number; // zone-units sold to neighbours
  powerTradeNet: number; // $ net from power trade last month (positive = income)
  // Fire
  fires: number; // burning tiles in this city right now
  fireStations: number; // powered fire stations
  // Neighbourhood
  neighbours: number; // distinct cities owning a chunk 8-adjacent to one of mine
  neighbourDemand: Demand; // part of `demand` contributed by neighbours (jobs/shoppers across the border)
  railLinks: number; // neighbour cities reachable from my zones over connected rail
  railDemand: number; // commercial demand added by rail links (already included in demand.c)
  // Special buildings
  crime: number; // 0..1 city crime level (lowers land value of uncovered lots)
  policeStations: number; // powered police stations
  specials: { stadium: number; seaport: number; airport: number }; // powered, counted for demand boosts
  traffic: number; // 0..1 average road density in the city (for the UI)
  // Milestones
  peakPop: number; // highest population reached (milestones are based on it)
  nextMilestone: number | null; // population needed for the next unlock (null when all are reached)
  unlocked: string[]; // milestone buildings this city may build (reached or grandfathered)
  built: Record<string, number>; // milestone buildings currently standing, by id (seaport/airport/cityhall)
  cityHall: number; // powered city halls (benefits apply)
  // Lifeline
  debt: number; // lifeline still owed
  lifelineAvailable: boolean; // the city may take a lifeline now
  // Budget (absent from old servers)
  budget?: Budget;
}

/**
 * The budget lines. Every dollar that enters or leaves a city is booked on one of these (the server's
 * `earn` / `spend`), so a year's lines always add up to its funds change.
 */
export const INCOME_LINES = ['taxes', 'powerSold', 'lifeline', 'gifts'] as const;
export const EXPENSE_LINES = ['roads', 'rail', 'power', 'services', 'powerBought', 'repaid', 'construction', 'plots'] as const;
export type IncomeLine = (typeof INCOME_LINES)[number];
export type ExpenseLine = (typeof EXPENSE_LINES)[number];
export type MoneyLine = IncomeLine | ExpenseLine;
/** One game year of a city's money: every line a positive $ figure (rounded). */
export type BudgetYear = { year: number } & Record<MoneyLine, number>;
export function emptyBudgetYear(year: number): BudgetYear {
  const y = { year } as BudgetYear;
  for (const k of [...INCOME_LINES, ...EXPENSE_LINES]) y[k] = 0;
  return y;
}
/** The budget screen: the year so far and the completed years before it (oldest first, the most recent BUDGET_YEARS_SENT). */
export interface Budget {
  current: BudgetYear;
  years: BudgetYear[];
}
export const BUDGET_YEARS_SENT = 5;
/** Totals of a budget year: upkeep, power trade (sold minus bought), the operating result and the net funds change. */
export function budgetTotals(y: BudgetYear): { upkeep: number; trade: number; operating: number; net: number } {
  const upkeep = y.roads + y.rail + y.power + y.services;
  const trade = y.powerSold - y.powerBought;
  const operating = y.taxes - upkeep + trade - y.repaid;
  return { upkeep, trade, operating, net: operating - y.construction - y.plots + y.lifeline + y.gifts };
}

export interface LeaderboardEntry {
  id: string;
  name: string;
  cityName: string;
  color: string;
  population: number;
  chunks: number;
  cx: number; // centroid chunk of the city, for "visit"
  cy: number;
  fires: number;
  /** share of milestones unlocked, 0..100 (the population ladder plus Grand Central); absent from old servers */
  milestones?: number;
}

/** A city retired as a monument: frozen forever, listed apart from the leaderboard. */
export interface MonumentEntry {
  id: string;
  name: string; // the mayor who built it
  cityName: string;
  color: string;
  population: number; // when it was retired
  chunks: number;
  cx: number; // centroid chunk, for "visit"
  cy: number;
  at: number; // ms epoch when it was retired
}

/** Where an online player is looking / pointing. */
export interface Presence {
  id: string;
  name: string;
  cityName: string;
  color: string;
  x: number; // camera centre, tiles
  y: number;
  zoom: number;
  cx?: number; // cursor tile, if hovering the map
  cy?: number;
}

export interface QueryInfo {
  x: number;
  y: number;
  tile: number;
  name: string; // human readable e.g. "Residential zone (24 pop)"
  powered: boolean;
  owner?: PlayerPublic;
  /** people in this zone on the top bar's scale (residents for homes, jobs for shops and industry) */
  zonePop?: number;
  /** which kind of zone zonePop belongs to (absent from old servers) */
  zoneKind?: 'res' | 'com' | 'ind';
  /** height above sea level in metres (below zero: under the sea; from the world's elevation map) */
  elev?: number;
}

// ---------- client -> server (JSON) ----------
export type ClientMsg =
  | { t: 'hello'; id?: string; token?: string; name?: string; v?: string } // v: client build version (absent on old clients)
  | { t: 'sub'; chunks: [number, number][] } // replaces the whole subscription set
  | { t: 'claim'; cx: number; cy: number }
  /** test servers (DISASTER_TRIGGER=1): start a disaster now in the city owning chunk cx,cy, or in a random city */
  | { t: 'testDisaster'; kind: number; cx?: number; cy?: number }
  | { t: 'build'; tool: ToolId; x: number; y: number }
  | { t: 'query'; x: number; y: number }
  | { t: 'findFree'; cx: number; cy: number } // nearest chunk to (cx,cy) a new city can be founded on
  | { t: 'rename'; name: string }
  | { t: 'renameCity'; name: string }
  | { t: 'view'; x: number; y: number; zoom: number; cx?: number; cy?: number } // throttled by the client (~4/s)
  | { t: 'leaderboard' } // ask for the current top list
  | { t: 'worldStats' } // ask for the world stats (answered with a 'worldStats' message)
  | { t: 'lifeline' } // take the emergency lifeline loan
  | { t: 'monument' } // retire my city (over MONUMENT_MIN_POP) as a monument and start over
  | { t: 'abandon' } // give up my broke city (owes a lifeline, under ABANDON_MAX_FUNDS): plots released as they stand, start over
  | { t: 'ping' };

// ---------- server -> client (JSON) ----------
export type ServerMsg =
  | {
      t: 'welcome';
      player: PlayerPublic & { token: string };
      stats: PlayerStats;
      world: { w: number; h: number; chunk: number };
      claims: ClaimInfo[];
      online: number;
      time: GameTime;
      /** a test server that lets players start disasters (DISASTER_TRIGGER=1): the client shows its test dialog */
      testDisasters?: boolean;
    }
  | { t: 'tiles'; u: number[] } // flat triples: x, y, value
  | { t: 'claim'; claim: ClaimInfo } // a chunk changed owner
  | { t: 'claims'; claims: ClaimInfo[] } // periodic: pops changed
  | { t: 'stats'; stats: PlayerStats } // the receiving player's own stats
  | { t: 'time'; time: GameTime; online: number }
  | { t: 'freeSpot'; cx: number | null; cy: number | null }
  | { t: 'query'; info: QueryInfo }
  | { t: 'toast'; msg: string; kind: 'info' | 'error' | 'success'; at?: { x: number; y: number }; big?: boolean } // `at`: clickable, fly there; `big`: news to notice (a disaster), shown larger and longer
  | { t: 'leaderboard'; entries: LeaderboardEntry[]; me?: { rank: number; population: number }; monuments?: MonumentEntry[] } // top cities (and monuments, absent from old servers); also pushed periodically
  | { t: 'presence'; players: Presence[] } // every PRESENCE_INTERVAL_MS, online players except the receiver
  | { t: 'airports'; airports: AirportInfo[]; now: number } // powered airports (sent on welcome and when the set changes); `now` = server clock ms, for flight sync
  | { t: 'unclaim'; cx: number; cy: number } // a chunk was released (abandoned); what was built there stays for the next claimant
  | { t: 'version'; version: string } // current client build on the server (on welcome and whenever a new build lands)
  | { t: 'announce'; id: string; msg: string; level: 'info' | 'warn'; until: number } // admin announcement banner; until = ms epoch
  | { t: 'announceClear' }
  | { t: 'shipping'; ports: PortInfo[]; routes: SeaRoute[]; now: number } // powered seaports + sea routes (on welcome and when they change)
  | { t: 'buildings'; list: CustomBuilding[] } // every custom-layer building (sent on welcome)
  | { t: 'building'; op: 'add' | 'remove'; b: CustomBuilding } // a custom-layer building appeared / went
  | { t: 'worldStats'; stats: WorldStats }
  | { t: 'disasters'; list: ActiveDisaster[] } // natural disasters on the go (on welcome, and whenever they change)
  | { t: 'pong' };

// ---------- binary frames (server -> client) ----------
// Full chunk: u8 kind=3, u16 cx, u16 cy, u8 flags, then the CHUNK*CHUNK tile values (kind, flags and look; see
// looks.ts), all little-endian: raw u32 (flags & 1 clear) or runs of (u8 count 1..255, u32 value) when that is
// smaller. Most of the world is untouched landscape, so a typical chunk is a few hundred bytes.
export const BIN_CHUNK = 3;
const CHUNK_TILES = CHUNK * CHUNK;

export interface ChunkFrame { cx: number; cy: number; tiles: Uint32Array }

export function encodeChunk(cx: number, cy: number, tiles: Uint32Array): ArrayBuffer {
  let runs = 0;
  for (let i = 0; i < CHUNK_TILES; ) { let j = i + 1; while (j < CHUNK_TILES && j - i < 255 && tiles[j] === tiles[i]) j++; runs++; i = j; }
  const rle = runs * 5 < CHUNK_TILES * 4;
  const buf = new ArrayBuffer(6 + (rle ? runs * 5 : CHUNK_TILES * 4));
  const dv = new DataView(buf);
  dv.setUint8(0, BIN_CHUNK);
  dv.setUint16(1, cx, true);
  dv.setUint16(3, cy, true);
  dv.setUint8(5, rle ? 1 : 0);
  let o = 6;
  if (rle) {
    for (let i = 0; i < CHUNK_TILES; ) {
      let j = i + 1; while (j < CHUNK_TILES && j - i < 255 && tiles[j] === tiles[i]) j++;
      dv.setUint8(o, j - i); dv.setUint32(o + 1, tiles[i], true); o += 5; i = j;
    }
  } else {
    for (let i = 0; i < CHUNK_TILES; i++, o += 4) dv.setUint32(o, tiles[i], true);
  }
  return buf;
}

export function decodeChunk(buf: ArrayBuffer): ChunkFrame | null {
  if (buf.byteLength < 6) return null;
  const dv = new DataView(buf);
  if (dv.getUint8(0) !== BIN_CHUNK) return null;
  const cx = dv.getUint16(1, true), cy = dv.getUint16(3, true), rle = (dv.getUint8(5) & 1) !== 0;
  const tiles = new Uint32Array(CHUNK_TILES);
  let o = 6;
  if (rle) {
    for (let i = 0; i < CHUNK_TILES; ) {
      if (o + 5 > buf.byteLength) return null;
      const n = dv.getUint8(o), v = dv.getUint32(o + 1, true); o += 5;
      if (!n || i + n > CHUNK_TILES) return null;
      tiles.fill(v, i, i + n); i += n;
    }
  } else {
    if (o + CHUNK_TILES * 4 > buf.byteLength) return null;
    for (let i = 0; i < CHUNK_TILES; i++, o += 4) tiles[i] = dv.getUint32(o, true);
  }
  return o === buf.byteLength ? { cx, cy, tiles } : null;
}

/** Deterministic player colour from id. */
export function colorForId(id: string): string {
  const palette = ['#ff5f5f', '#ffb347', '#ffe84d', '#7ddc5c', '#4dd0e1', '#5f8bff', '#b47aff', '#ff7ad9', '#ff9a76', '#9be564'];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}
