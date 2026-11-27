// World geometry. The whole world is one tile grid, drawn as a planet in equirectangular projection (tile x ->
// longitude -180..180, y -> latitude 90..-90). Its size comes from the world itself (base.json, see
// docs/world-format.md): the server calls configureWorld() at boot, before it builds anything, and the client does
// the same with the size in the server's welcome. Until then these hold the generated Earth's size. They are live
// bindings: read them when needed, never copy them into a module-level constant.
export const CHUNK = 64; // tiles per chunk side; a chunk is also the unit players claim
/** The generated Earth's size: the default for worlds that don't say (and what the world generator makes). */
export const EARTH_W = 16384, // 8192 before the world reset
  EARTH_H = 8192;
/** World sizes must be a multiple of this (a zoomed-out map region, shared/src/maptiles.ts). */
export const WORLD_SIZE_STEP = 256;
export let WORLD_W = EARTH_W; // tiles across
export let WORLD_H = EARTH_H; // tiles down
export let CHUNKS_X = WORLD_W / CHUNK; // 256 on the Earth
export let CHUNKS_Y = WORLD_H / CHUNK; // 128
/** Names the world's generated files (data/world-<tag>/) and is stamped into every save, so a save is never
 *  loaded into a world of another size. */
export let WORLD_TAG = `${WORLD_W}x${WORLD_H}`;

/** Set the world's size (once at boot, before anything size-dependent is built). Throws on a size the game can't
 *  use: both must be positive multiples of WORLD_SIZE_STEP. */
export function configureWorld(w: number, h: number): void {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0 || w % WORLD_SIZE_STEP || h % WORLD_SIZE_STEP)
    throw new Error(`world size ${w}x${h}: both sides must be positive multiples of ${WORLD_SIZE_STEP} tiles`);
  WORLD_W = w;
  WORLD_H = h;
  CHUNKS_X = w / CHUNK;
  CHUNKS_Y = h / CHUNK;
  WORLD_TAG = `${w}x${h}`;
}
export const TILE_PX = 16; // sprite size in tiles.png

// Economy
export const STARTING_FUNDS = 20000;
/** A city this big can be retired as a monument: frozen forever on the map, and its mayor starts over. */
export const MONUMENT_MIN_POP = 1_000_000;
/** Any city may be abandoned (its plots are released, buildings and all); under this many $ while owing a lifeline,
 *  the top bar suggests it. */
export const ABANDON_MAX_FUNDS = 100;
/** After abandoning, a mayor can't claim the plots they left for this many days (no free restart with the old town). */
export const ABANDON_RECLAIM_DAYS = 7;
/** Longest mayor and city names, in characters. */
export const MAX_MAYOR_NAME = 24;
export const MAX_CITY_NAME = 32;
// Claiming more plots: the first is free, then the price escalates geometrically with every plot you own
// (2nd $25,000, 3rd $43,750, 4th $76,563 ... 10th about $2.2M). Must be adjacent to one you own.
export const CLAIM_BASE_COST = 25000;
export const CLAIM_COST_GROWTH = 1.75;
/** Price of the next plot for a player who already owns `owned` plots (0 -> free). */
export function claimCost(owned: number): number {
  if (owned <= 0) return 0;
  return Math.round((CLAIM_BASE_COST * Math.pow(CLAIM_COST_GROWTH, owned - 1)) / 500) * 500;
}
/** A chunk needs at least this many non-water tiles (of 64x64 = 4096) to be claimed as an extra, adjacent plot.
 *  Low on purpose: buying a coastal strip next to your city is a fine choice. */
export const MIN_LAND_TILES_TO_CLAIM = 64;
/** A founding (first) plot needs much more land, so a new mayor can't get stuck on a sliver of coast: a quarter of
 *  the plot, i.e. a 32x32 block's worth. A small working city (coal plant 4x4, ~15-20 3x3 zones, roads and wires)
 *  needs ~300-400 tiles, and coastlines are ragged, so ~3x that. On the generated Earth this still leaves ~86% of the
 *  plots with any real land open to found on, and in plots at this level the biggest connected piece of land is
 *  almost always 500+ tiles (the land isn't scattered islets). Existing claims are never re-checked. */
export const MIN_LAND_TILES_FIRST_CLAIM = 1024;
/** Land tiles a chunk needs to be claimed by a player who already owns `owned` plots. */
export function minLandToClaim(owned: number): number {
  return owned <= 0 ? MIN_LAND_TILES_FIRST_CLAIM : MIN_LAND_TILES_TO_CLAIM;
}
export const MAX_CHUNKS_PER_PLAYER = 15; // a city is at most this many plots
export const TAX_RATE = 7; // percent, SimCity classic default
// Budget. The clock runs 24/7 (one game year every 60 real seconds), so income is scaled hard:
// a mid-size city nets roughly $8-12k per real hour while its mayor is online.
export const TAX_MULT = 0.1; // multiplier on the SimCity tax formula
// Yearly maintenance (charged monthly), SimCity-style: infrastructure costs money to keep.
export const UPKEEP_ROAD = 1; // per road tile per year
export const UPKEEP_RAIL = 2; // per rail tile per year
export const UPKEEP_STATION = 100; // fire or police station per year
export const UPKEEP_COAL = 150; // per plant per year
export const UPKEEP_NUCLEAR = 300;
// A city whose mayor has been away this long is frozen: no growth or decline, no traffic, no taxes or
// upkeep, and fire can't spread into it. Its power plants keep supplying neighbours. It resumes exactly
// where it was when the mayor returns (any message, incl. the client's 20 s ping, counts as presence).
export const CITY_FREEZE_MS = 15 * 60_000;
/**
 * Power is counted in units of one zone's need, shown as megawatts: 1 unit = 1 MW. That puts the plants close to
 * real ones (coal 400 MW, nuclear 1.2 GW: one reactor, a wind farm 40 MW, offshore wind 60 MW) and a city's use near
 * real electricity use per person (a zone houses a few hundred people).
 */
export const MW_PER_POWER_UNIT = 1;
/** A power amount in units, as watts: "400 MW", "1.2 GW", "19.2 GW". */
export function fmtPower(units: number): string {
  const mw = units * MW_PER_POWER_UNIT;
  const f = (v: number, u: string): string => `${+v.toFixed(v < 10 ? 2 : 1)} ${u}`;
  return Math.abs(mw) >= 1e6 ? f(mw / 1e6, 'TW') : Math.abs(mw) >= 1e3 ? f(mw / 1e3, 'GW') : `${Math.round(mw).toLocaleString('en-US')} MW`;
}
export const POWER_PRICE_PER_UNIT = 1; // $ per unit (MW) per simulation step, paid by importer to exporter
export const LEADERBOARD_SIZE = 20;

// Abandonment: idle cities are shown as abandoned, then their plots become claimable again. Nothing decays:
// whoever claims a released plot gets everything built on it, at the normal plot price.
export const ABANDON_IDLE_DAYS = 30; // owner not seen for this long -> shown as abandoned
export const ABANDON_FREE_DAYS = 60; // ...and after this long the claims are released
// Nature returns: every REGROW_MS each rubble tile has REGROW_P chance of turning back into the landscape that
// was there before anyone built (dirt, forest, shore), except in cities whose mayor is playing right now.
// At 2% every 5 minutes a field of rubble is half gone after about 3 hours and nearly all gone in half a day.
export const REGROW_MS = 5 * 60_000;
export const REGROW_P = 0.02;
// Barely-started cities don't hold land for long: with fewer than SMALL_CITY_MAX_ITEMS things built
// (each zone/building counts once, each road/rail/power line/park tile once) and the mayor away for
// SMALL_CITY_RELEASE_MS, the plots are released for others to claim.
export const SMALL_CITY_MAX_ITEMS = 5;
export const SMALL_CITY_RELEASE_MS = 60 * 60_000;

// Neighbour effects
export const NEIGHBOUR_DEMAND_MAX = 0.35; // cap on demand added by adjacent cities' pops
export const RAIL_LINK_BOOST = 0.15; // commercial demand per rail-linked neighbour city (scaled by its pop)
export const RAIL_LINK_MAX = 0.5;

// Traffic (simplified Micropolis makeTraffic): serviced zones send short random drives along roads;
// road tiles accumulate density that decays, and are drawn light/heavy above thresholds.
// Trip odds per tick scale with the zone's size (a house street is quiet, towers are busy), and a zone
// with rail within TRAFFIC_RAIL_REACH tiles sends most of its trips by train instead.
export const TRAFFIC_MAX_STEPS = 16; // tiles per drive
export const TRAFFIC_ADD = 8; // density added to each road tile driven over
/** RCI demand moves this share of the way to its newly computed value each tick (like Micropolis' valves, which
 *  accumulate rather than jump): most of a change settles within 10-15 simulation steps. */
export const DEMAND_SMOOTHING = 0.15;
export const TRAFFIC_DECAY = 0.8; // multiplier per tick
export const TRAFFIC_LIGHT = 80; // density >= -> light traffic tiles
export const TRAFFIC_HEAVY = 150; // density >= -> heavy traffic tiles
export const TRAFFIC_RAIL_SHARE = 0.7; // share of a rail-served zone's trips taken off the road
export const TRAFFIC_RAIL_REACH = 6; // a zone is rail-served when track is within this many tiles of its centre (a short walk to the line)

// Special buildings (all require power)
// Lifeline: a broke city (funds below LIFELINE_MAX_FUNDS, nothing owed) can take an interest-free loan,
// repaid automatically as a share of each step's surplus (nothing is taken in steps at a loss).
// Early cities (peak population below LIFELINE_EARLY_PEAK_POP) may take more while still repaying, as long as
// the total owed stays within LIFELINE_MAX_DEBT; bigger cities must repay before the next one.
export const LIFELINE_AMOUNT = 10_000;
export const LIFELINE_MAX_FUNDS = 1_000;
export const LIFELINE_REPAY_SHARE = 0.25;
export const LIFELINE_EARLY_PEAK_POP = 2_000;
export const LIFELINE_MAX_DEBT = 30_000;
export const CITYHALL_TAX_BONUS = 0.1; // +10% taxes with a powered city hall
export const CITYHALL_CRIME_FACTOR = 0.6; // crime x0.6 with a powered city hall
export const UPKEEP_CITYHALL = 200; // per year
export const UPKEEP_SCHOOL = 100;
export const UPKEEP_WIND = 10;
export const UPKEEP_OFFSHORE = 30;
export const UPKEEP_UNIVERSITY = 300;
export const GRAND_CENTRAL_RANGE = 20; // zones within this many tiles of a powered Grand Central count as rail-served
export const GRAND_CENTRAL_RAIL_BOOST = 1.5; // rail-link demand multiplier for a city with a powered Grand Central
export const UPKEEP_GRANDCENTRAL = 200; // per year
export const UNIVERSITY_POLICE_FACTOR = 2; // police stations in a city with a powered university cover twice the range
export const UNIVERSITY_RANGE = 12; // a powered university raises land value within this range
export const UNIVERSITY_IND_BOOST = 0.1;
export const CHRISTMAS_TREE_RANGE = 6; // a powered Christmas tree raises land value within this Chebyshev range
export const SCHOOL_RANGE = 8; // a powered school raises land value within this Chebyshev range
export const STADIUM_RES_BOOST = 0.15; // residential demand per powered stadium (cap 1 stadium counts)
export const SEAPORT_IND_BOOST = 0.2; // industrial demand per powered seaport (needs water within 6 tiles)
export const AIRPORT_COM_BOOST = 0.2; // commercial demand per powered airport
export const CRIME_LAND_VALUE_THRESHOLD = 0.5; // city crime at/above this costs uncovered lots one land value step
export const POLICE_RANGE = 14; // Chebyshev tiles covered by a powered police station
export const CRIME_PER_POP = 1 / 60_000; // city crime level = min(1, population * CRIME_PER_POP); reaches CRIME_LAND_VALUE_THRESHOLD (0.5) at 30,000 people, the police milestone

// Presence
export const PRESENCE_INTERVAL_MS = 500; // server broadcast cadence
export const PRESENCE_MAX = 200; // max players in one presence frame
export const LEADERBOARD_PUSH_TICKS = 10; // broadcast top list every N ticks if changed

// Fire (simplified Micropolis doFire): per-tick probabilities
// Tuned so an uncovered fire is roughly self-limiting (R0 ~ 1.5) and a covered one dies out (R0 < 0.5):
// R0 = 4 neighbours * spread / burnout.
export const FIRE_SPREAD_P = 1 / 16; // per burning tile, per burnable neighbour
export const FIRE_BURNOUT_P = 1 / 6; // burning tile -> rubble, no station in range
export const FIRE_BURNOUT_P_COVERED = 1 / 3; // ...with a powered fire station in range
export const FIRE_STATION_RANGE = 12; // Chebyshev distance from the station centre
// The world clock never stops, so outbreaks are rare in real time (~1 per 40 real minutes for a 30-zone
// city) and only happen while the owner is online (lastSeen within FIRE_OWNER_ONLINE_MS), so nobody
// comes back to a city that burnt down while they slept.
export const FIRE_OUTBREAK_BASE_P = 0.0008; // per city per tick at ~30 zones; scales with sqrt(zones/30)
export const FIRE_OWNER_ONLINE_MS = 60_000;
/** Chance that an outbreak inside a powered fire station's range never starts (it is put out at once). */
export const FIRE_PREVENTED_P = 0.75;

// Time: the simulation takes a step every TICK_MS (slowed from 2 s on 2026-10-28: the game felt easy past the
// early stage). Growth, traffic, fires, taxes and upkeep all run per step. The calendar is slower: a game month
// every STEPS_PER_MONTH steps, so a game year takes 30 real minutes (an hour until 2026-11-26, a minute before
// the 2x world).
// Money constants named "a year" below are per 12 steps (one real minute); a game year is STEPS_PER_MONTH times
// as long, so its budget shows that many times more (gameYearAmount).
export const TICK_MS = 5000;
export const STEPS_PER_MONTH = 30;
/** What an amount given per 12 steps (the money constants) comes to over a game year. */
export const gameYearAmount = (per12Steps: number): number => per12Steps * STEPS_PER_MONTH;
export const START_YEAR = 1900;

// Networking
export const MAX_SUBSCRIBED_CHUNKS = 80;
export const DEFAULT_PORT = 8787;
