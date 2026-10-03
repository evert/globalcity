// World geometry. The whole Earth is one tile grid in equirectangular projection.
export const WORLD_W = 8192; // tiles (longitude -180..180)
export const WORLD_H = 4096; // tiles (latitude 90..-90)
export const CHUNK = 64; // tiles per chunk side; a chunk is also the unit players claim
export const CHUNKS_X = WORLD_W / CHUNK; // 128
export const CHUNKS_Y = WORLD_H / CHUNK; // 64
export const TILE_PX = 16; // sprite size in tiles.png

// Economy
export const STARTING_FUNDS = 20000;
export const EXTRA_CLAIM_COST = 2500; // claiming a 2nd, 3rd... chunk (must be adjacent to one you own)
export const MIN_LAND_TILES_TO_CLAIM = 64;
export const MAX_CHUNKS_PER_PLAYER = 10; // a city is at most this many plots // a chunk needs at least this much land to be claimable
export const TAX_RATE = 7; // percent, SimCity classic default
export const POWER_PRICE_PER_UNIT = 1; // $ per zone-unit per game month, paid by importer to exporter
export const LEADERBOARD_SIZE = 20;

// Abandonment: idle cities decay, then their plots become claimable again (ruins stay on the map)
export const ABANDON_DECAY_DAYS = 30; // owner not seen for this long -> tiles start decaying
export const ABANDON_FREE_DAYS = 60; // ...and after this long the claims are released
export const ABANDON_DECAY_P = 0.004; // per zone/building/road tile per tick once decaying

// Neighbour effects
export const NEIGHBOUR_DEMAND_MAX = 0.35; // cap on demand added by adjacent cities' pops
export const RAIL_LINK_BOOST = 0.15; // commercial demand per rail-linked neighbour city (scaled by its pop)
export const RAIL_LINK_MAX = 0.5;

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
