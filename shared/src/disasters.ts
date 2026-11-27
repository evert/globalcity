// Natural disasters. Each kind only happens where it happens on Earth: the world generator records, per chunk,
// which kinds are possible there (data/world-*/hazards.bin, one byte of HAZARD bits per chunk), from plate
// boundaries, elevation, climate and storm regions. Disasters strike about every 15 minutes in the whole world,
// always a city whose mayor is online, and everyone playing is told. A disaster only touches the plots of the
// city it strikes.

export enum Disaster { Earthquake = 0, Flood = 1, Tornado = 2, Storm = 3, Wildfire = 4, Blizzard = 5 }
export const DISASTER_COUNT = 6;
/** hazards.bin bits: the disasters possible in a chunk */
export const hazardBit = (d: Disaster): number => 1 << d;

export interface DisasterInfo { name: string; emoji: string; verb: string }
export const DISASTERS: Record<Disaster, DisasterInfo> = {
  [Disaster.Earthquake]: { name: 'Earthquake', emoji: '🌋', verb: 'An earthquake shook' },
  [Disaster.Flood]: { name: 'Flood', emoji: '🌊', verb: 'Floodwater is rising in' },
  [Disaster.Tornado]: { name: 'Tornado', emoji: '🌪', verb: 'A tornado touched down in' },
  [Disaster.Storm]: { name: 'Tropical storm', emoji: '🌀', verb: 'A tropical storm hit' },
  [Disaster.Wildfire]: { name: 'Wildfire', emoji: '🔥', verb: 'A wildfire is spreading into' },
  [Disaster.Blizzard]: { name: 'Blizzard', emoji: '❄️', verb: 'A blizzard buried' },
};

/** At most one disaster in the whole world in this long. */
export const DISASTER_MIN_GAP_MS = 10 * 60_000;
/** ...and a city that was struck is spared for this long (real time), however few other cities can be struck. */
export const DISASTER_CITY_GAP_MS = 4 * 60 * 60_000;
/** Once the gap has passed, the chance per simulation step that a disaster strikes one of the cities that can be
 *  struck (60 steps in 5 minutes at 5 s): on average 5 minutes later, so roughly one every 15 minutes worldwide. */
export const DISASTER_STEP_P = 1 / 60;
/** Small towns are spared: disasters start once a city has this many people (the fire station milestone). */
export const DISASTER_MIN_POP = 15_000;

// ---- where storms and tornadoes happen (lat/lon boxes: [south, north, west, east]) ----
/** Tornado Alley and the other regions with frequent strong tornadoes. */
export const TORNADO_REGIONS: readonly [number, number, number, number][] = [
  [29, 46, -104, -82], // US Great Plains and Midwest ("Tornado Alley", "Dixie Alley")
  [-38, -24, -66, -52], // Argentina, Uruguay, southern Brazil
  [20, 27, 85, 93], // Bangladesh and eastern India
  [44, 53, -2, 30], // central Europe (rarer, but real)
  [-38, -26, 140, 154], // eastern Australia
];
/** Tropical cyclone basins (hurricanes, typhoons, cyclones), where they make landfall. */
export const STORM_REGIONS: readonly [number, number, number, number][] = [
  [8, 36, -100, -58], // North Atlantic: Caribbean, Gulf of Mexico, US east coast
  [8, 32, -118, -94], // eastern Pacific: Mexico's Pacific coast
  [5, 40, 100, 146], // western Pacific typhoons: Philippines, China, Taiwan, Japan, Korea
  [8, 25, 78, 98], // Bay of Bengal and Arabian Sea coasts
  [-28, -8, 30, 62], // southwest Indian Ocean: Madagascar, Mozambique
  [-30, -10, 110, 160], // northern Australia and the southwest Pacific
];
export const inRegions = (regions: readonly [number, number, number, number][], lat: number, lon: number): boolean =>
  regions.some(([s, n, w, e]) => lat >= s && lat <= n && lon >= w && lon <= e);

/** Active disasters the clients draw (tornadoes move; the others are where they are). */
export interface ActiveDisaster { id: number; kind: Disaster; x: number; y: number; ownerId: string; city: string; until: number }
