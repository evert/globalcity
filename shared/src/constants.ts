// World geometry. The whole Earth is one tile grid in equirectangular projection.
export const WORLD_W = 8192; // tiles (longitude -180..180)
export const WORLD_H = 4096; // tiles (latitude 90..-90)
export const CHUNK = 64; // tiles per chunk side; a chunk is also the unit players claim
export const CHUNKS_X = WORLD_W / CHUNK; // 128
export const CHUNKS_Y = WORLD_H / CHUNK; // 64
export const TILE_PX = 16; // sprite size in tiles.png

// Economy
export const STARTING_FUNDS = 20000;
// Claiming more plots: the first is free, then the price escalates geometrically with every plot you own
// (2nd $25,000, 3rd $43,750, 4th $76,563 ... 10th about $2.2M). Must be adjacent to one you own.
export const CLAIM_BASE_COST = 25000;
export const CLAIM_COST_GROWTH = 1.75;
/** Price of the next plot for a player who already owns `owned` plots (0 -> free). */
export function claimCost(owned: number): number {
  if (owned <= 0) return 0;
  return Math.round((CLAIM_BASE_COST * Math.pow(CLAIM_COST_GROWTH, owned - 1)) / 500) * 500;
}
export const MIN_LAND_TILES_TO_CLAIM = 64;
export const MAX_CHUNKS_PER_PLAYER = 10; // a city is at most this many plots // a chunk needs at least this much land to be claimable
export const TAX_RATE = 7; // percent, SimCity classic default
// Budget. The clock runs 24/7 (one game year every 24 real seconds), so income is scaled hard:
// a mid-size city nets roughly $20-30k per real hour while its mayor is online.
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
export const POWER_PRICE_PER_UNIT = 1; // $ per zone-unit per game month, paid by importer to exporter
export const LEADERBOARD_SIZE = 20;

// Abandonment: idle cities decay, then their plots become claimable again (ruins stay on the map)
export const ABANDON_DECAY_DAYS = 30; // owner not seen for this long -> tiles start decaying
export const ABANDON_FREE_DAYS = 60; // ...and after this long the claims are released
export const ABANDON_DECAY_P = 0.004;
// Barely-started cities don't hold land for long: with fewer than SMALL_CITY_MAX_ITEMS things built
// (each zone/building counts once, each road/rail/power line/park tile once) and the mayor away for
// SMALL_CITY_RELEASE_MS, the plots are released for others to claim.
export const SMALL_CITY_MAX_ITEMS = 5;
export const SMALL_CITY_RELEASE_MS = 60 * 60_000; // per zone/building/road tile per tick once decaying

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
export const TRAFFIC_DECAY = 0.8; // multiplier per tick
export const TRAFFIC_LIGHT = 80; // density >= -> light traffic tiles
export const TRAFFIC_HEAVY = 150; // density >= -> heavy traffic tiles
export const TRAFFIC_RAIL_SHARE = 0.7; // share of a rail-served zone's trips taken off the road
export const TRAFFIC_RAIL_REACH = 6; // a zone is rail-served when track is within this many tiles of its centre (a short walk to the line)

// Special buildings (all require power)
export const CITYHALL_TAX_BONUS = 0.1; // +10% taxes with a powered city hall
export const CITYHALL_CRIME_FACTOR = 0.6; // crime x0.6 with a powered city hall
export const UPKEEP_CITYHALL = 200; // per year
export const STADIUM_RES_BOOST = 0.15; // residential demand per powered stadium (cap 1 stadium counts)
export const SEAPORT_IND_BOOST = 0.2; // industrial demand per powered seaport (needs water within 6 tiles)
export const AIRPORT_COM_BOOST = 0.2; // commercial demand per powered airport
export const POLICE_RANGE = 14; // Chebyshev tiles covered by a powered police station
export const CRIME_PER_POP = 1 / 4000; // city crime level = min(1, population * CRIME_PER_POP) outside police cover

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

// Time: one game month per tick
export const TICK_MS = 2000;
export const START_YEAR = 1900;

// Networking
export const MAX_SUBSCRIBED_CHUNKS = 80;
export const DEFAULT_PORT = 8787;
