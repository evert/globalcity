import * as T from './tiles.ts';
import { UPKEEP_WIND } from './constants.ts';

export type ToolId =
  | 'query' | 'bulldozer' | 'road' | 'rail' | 'wire' | 'park'
  | 'residential' | 'commercial' | 'industrial'
  | 'fire' | 'police' | 'coal' | 'nuclear' | 'stadium' | 'seaport' | 'airport' | 'cityhall'
  | 'school' | 'windfarm' | 'offshore' | 'university' | 'grandcentral';

export interface ToolDef {
  id: ToolId;
  name: string;
  cost: number;
  /** footprint side in tiles; 1 for single-tile tools */
  size: 1 | 3 | 4 | 5 | 6;
  /** non-square footprints (custom-building layer): width and height in tiles; default size x size */
  w?: number;
  h?: number;
  /** custom-building layer kind (drawn as one image, see CUSTOM_BUILDINGS) */
  custom?: string;
  /** the footprint tile under the cursor (default (1,1), Micropolis' hot spot); Grand Central uses its rail row */
  hot?: { x: number; y: number };
  /** first tile id of the building footprint (row-major), for multi-tile tools */
  base?: number;
  hotkey: string;
  /** representative tile id used for the toolbar icon */
  icon: number;
}

// Costs follow SimCity Classic / Micropolis.
export const TOOLS: Record<ToolId, ToolDef> = {
  query:       { id: 'query',       name: 'Query',             cost: 0,     size: 1, hotkey: 'q', icon: T.FOUNTAIN },
  bulldozer:   { id: 'bulldozer',   name: 'Bulldozer',         cost: 1,     size: 1, hotkey: 'b', icon: T.RUBBLE },
  road:        { id: 'road',        name: 'Road',              cost: 10,    size: 1, hotkey: 'r', icon: T.ROADS },
  rail:        { id: 'rail',        name: 'Rail',              cost: 20,    size: 1, hotkey: 't', icon: T.LHRAIL },
  wire:        { id: 'wire',        name: 'Power line',        cost: 5,     size: 1, hotkey: 'i', icon: T.LHPOWER },
  park:        { id: 'park',        name: 'Park',              cost: 10,    size: 1, hotkey: 'p', icon: T.WOODS },
  residential: { id: 'residential', name: 'Residential zone',  cost: 100,   size: 3, base: T.RESBASE,      hotkey: '1', icon: T.FREEZ },
  commercial:  { id: 'commercial',  name: 'Commercial zone',   cost: 100,   size: 3, base: T.COMBASE,      hotkey: '2', icon: T.COMCLR },
  industrial:  { id: 'industrial',  name: 'Industrial zone',   cost: 100,   size: 3, base: T.INDBASE,      hotkey: '3', icon: T.INDCLR },
  fire:        { id: 'fire',        name: 'Fire station',      cost: 500,   size: 3, base: T.FIRESTBASE,   hotkey: 'f', icon: T.FIRESTATION },
  police:      { id: 'police',      name: 'Police station',    cost: 500,   size: 3, base: T.POLICESTBASE, hotkey: 'l', icon: T.POLICESTATION },
  coal:        { id: 'coal',        name: 'Coal power plant',  cost: 3000,  size: 4, base: T.COALBASE,     hotkey: 'c', icon: T.POWERPLANT },
  nuclear:     { id: 'nuclear',     name: 'Nuclear plant',     cost: 50000, size: 4, base: T.NUCLEARBASE,  hotkey: 'n', icon: T.NUCLEAR },
  stadium:     { id: 'stadium',     name: 'Stadium',           cost: 5000,  size: 4, base: T.STADIUMBASE,  hotkey: 'm', icon: T.STADIUM },
  seaport:     { id: 'seaport',     name: 'Seaport',           cost: 3000,  size: 4, base: T.PORTBASE,     hotkey: 'o', icon: T.PORT },
  airport:     { id: 'airport',     name: 'Airport',           cost: 10000, size: 6, base: T.AIRPORTBASE,  hotkey: 'j', icon: T.AIRPORT },
  cityhall:    { id: 'cityhall',    name: 'City hall',         cost: 6000,  size: 4, base: T.CITYHALLBASE, hotkey: 'u', icon: T.CITYHALL },
  school:      { id: 'school',      name: 'Elementary school', cost: 1500,  size: 3, base: T.SCHOOLBASE,   hotkey: 'e', icon: T.SCHOOL },
  windfarm:    { id: 'windfarm',    name: 'Wind farm',         cost: 1600,  size: 4, base: T.WINDBASE,     hotkey: 'z', icon: T.WINDFARM },
  offshore:    { id: 'offshore',    name: 'Offshore wind farm', cost: 8000, size: 4, base: T.OFFSHOREBASE, hotkey: 'x', icon: T.OFFSHORE },
  university:  { id: 'university',  name: 'University',        cost: 8000,  size: 5, w: 5, h: 4, custom: 'university', hotkey: 'y', icon: T.CUSTOMCENTRE },
  grandcentral: { id: 'grandcentral', name: 'Grand Central',    cost: 25000, size: 6, w: 6, h: 3, custom: 'grandcentral', hot: { x: 2, y: 2 }, hotkey: 'k', icon: T.CUSTOMCENTRE },
};

export const TOOL_ORDER: ToolId[] = [
  'query', 'bulldozer', 'road', 'rail', 'wire', 'park',
  'residential', 'commercial', 'industrial',
  'fire', 'police', 'coal', 'nuclear', 'windfarm', 'offshore', 'school', 'university', 'stadium', 'seaport', 'airport', 'grandcentral', 'cityhall',
];

/** Extra costs for special placements. */
export const BRIDGE_COST = 50; // road over water
export const UNDERWATER_WIRE_COST = 25;
export const UNDERWATER_RAIL_COST = 100;
export const AUTO_BULLDOZE_COST = 1; // per tree/rubble tile removed when building over it

/**
 * For multi-tile tools the hot-spot (the tile the user clicks) is at offset (1,1)
 * from the top-left of the footprint, for every size (Micropolis convention).
 * Returns the top-left tile of the footprint.
 */
/** Footprint width and height in tiles. */
export const toolW = (t: ToolDef): number => t.w ?? t.size;
export const toolH = (t: ToolDef): number => t.h ?? t.size;

export function footprintOrigin(tool: ToolDef, x: number, y: number): { x0: number; y0: number } {
  if (tool.hot) return { x0: x - tool.hot.x, y0: y - tool.hot.y };
  if (tool.size === 1) return { x0: x, y0: y };
  return { x0: x - 1, y0: y - 1 };
}

/** Power produced per plant, in zone-units (Micropolis values). */
// Power per plant, in zones served. (Micropolis used 700 / 2000; GlobalCity cities grow much larger, so
// plants are smaller and there are clean alternatives.)
export const COAL_POWER = 400;
export const NUCLEAR_POWER = 1200;
export const WIND_POWER = 40; // a handful of turbines, not a whole farm: wind's price is land, you need many of them
export const OFFSHORE_POWER = 150;
/** Zones each power plant tool supplies, for labels. */
export const PLANT_OUTPUT: Partial<Record<ToolId, number>> = { coal: COAL_POWER, nuclear: NUCLEAR_POWER, windfarm: WIND_POWER, offshore: OFFSHORE_POWER };

// ---- Milestones ----
// Special buildings unlock when the city's peak population reaches their threshold; unlocks are permanent.
// `max` limits how many a city may have (city hall: one); a destroyed one can always be rebuilt. Cities that
// already had a building before it was unlocked keep it (grandfathered, counts as unlocked).
export type MilestoneBuilding = 'fire' | 'police' | 'cityhall' | 'windfarm' | 'school' | 'seaport' | 'university' | 'stadium' | 'airport' | 'offshore';
export interface MilestoneDef { name: string; tool: ToolId; pop: number; max?: number; benefits: string[]; centres: number[] }
export const MILESTONE_BUILDINGS: Record<MilestoneBuilding, MilestoneDef> = {
  fire: { name: 'Fire station', tool: 'fire', pop: 15_000, centres: [T.FIRESTATION],
    benefits: ['Fires can break out from this size on', 'Protects 12 tiles around it: most fires there never start, the rest spread slower and burn out sooner', 'Needs power'] },
  police: { name: 'Police station', tool: 'police', pop: 30_000, centres: [T.POLICESTATION],
    benefits: ['Covers 14 tiles: no crime penalty on land value there', 'Needs power'] },
  cityhall: { name: 'City hall', tool: 'cityhall', pop: 75_000, max: 1, centres: [T.CITYHALL],
    benefits: ['+10% tax income', 'Crime 40% lower across the city', 'One per city', 'Needs power'] },
  windfarm: { name: 'Wind farm', tool: 'windfarm', pop: 150_000, centres: [T.WINDFARM],
    benefits: [`${WIND_POWER} zones of clean power: a few turbines, so a city runs on many of them`, 'No pollution, quiet: neighbours don\'t mind', `$${UPKEEP_WIND} a year to run`] },
  school: { name: 'Elementary school', tool: 'school', pop: 50_000, centres: [T.SCHOOL],
    benefits: ['Lots within 8 tiles gain land value', 'Needs power'] },
  seaport: { name: 'Seaport', tool: 'seaport', pop: 100_000, centres: [T.PORT],
    benefits: ['Industrial demand boost', 'Must be within 6 tiles of water', 'Some pollution', 'Needs power'] },
  university: { name: 'University', tool: 'university', pop: 200_000, max: 1, centres: [],
    benefits: ['Lots within 12 tiles gain land value', 'Industrial demand boost (research jobs)', 'Reduces need for police', 'One per city', 'Needs power'] },
  stadium: { name: 'Stadium', tool: 'stadium', pop: 250_000, centres: [T.STADIUM, T.FULLSTADIUM],
    benefits: ['Residential demand boost', 'Hosts football games', 'Needs power'] },
  airport: { name: 'Airport', tool: 'airport', pop: 500_000, centres: [T.AIRPORT],
    benefits: ['Commercial demand boost once another mayor has an airport', 'Planes fly between your city and theirs', 'Some pollution', 'Needs power'] },
  offshore: { name: 'Offshore wind farm', tool: 'offshore', pop: 300_000, centres: [T.OFFSHORE],
    benefits: [`${OFFSHORE_POWER} zones of clean power`, 'Must be placed entirely on water', 'Connect it to shore with an underwater power line'] },
};
export const MILESTONE_ORDER: readonly MilestoneBuilding[] = ['fire', 'police', 'school', 'cityhall', 'seaport', 'windfarm', 'university', 'stadium', 'offshore', 'airport'];
/** Everything the Milestones panel lists: the population ladder plus Grand Central (unlocked by a rail link). */
export const MILESTONE_TOTAL = MILESTONE_ORDER.length + 1;
/** Percentage of milestones a city has unlocked, from its unlocked list (ladder, grandfathered and grandcentral). */
export const milestonePercent = (unlocked: readonly string[]): number =>
  Math.round((100 * new Set(unlocked.filter((b) => b === 'grandcentral' || (MILESTONE_ORDER as readonly string[]).includes(b))).size) / MILESTONE_TOTAL);
export const isMilestoneTool = (t: ToolId): t is MilestoneBuilding => t in MILESTONE_BUILDINGS;
/** Milestone buildings unlocked by a peak population (not counting grandfathered ones). */
export const milestoneUnlocksFor = (peakPop: number): MilestoneBuilding[] => MILESTONE_ORDER.filter((b) => peakPop >= MILESTONE_BUILDINGS[b].pop);
/** The next milestone above a peak population, or null when all are reached. */
export function nextMilestone(peakPop: number): { building: MilestoneBuilding; pop: number } | null {
  const b = MILESTONE_ORDER.find((k) => peakPop < MILESTONE_BUILDINGS[k].pop);
  return b ? { building: b, pop: MILESTONE_BUILDINGS[b].pop } : null;
}
/** Which milestone building has this centre tile id (or null). */
export function milestoneForCentre(id: number): MilestoneBuilding | null {
  for (const b of MILESTONE_ORDER) if (MILESTONE_BUILDINGS[b].centres.includes(id)) return b;
  return null;
}

// ---- Custom-building layer ----
/** Buildings drawn as one image over a w x h footprint. image: path under client/public. */
export interface CustomDef {
  name: string; w: number; h: number; image: string;
  /** animated: the image is `frames` frames side by side, each shown for `frameMs` */
  frames?: number; frameMs?: number;
  /** a footprint row that is real rail (trains run through it); it stays when the building is removed */
  railRow?: number;
}
export const CUSTOM_BUILDINGS: Record<string, CustomDef> = {
  university: { name: 'University', w: 5, h: 4, image: '/assets/buildings/university.png' },
  grandcentral: { name: 'Grand Central', w: 6, h: 3, image: '/assets/buildings/grandcentral.png', frames: 8, frameMs: 500, railRow: 2 },
};

/**
 * Grand Central: a landmark station on an east-west rail line, one per city. It unlocks the first time the
 * city's rail network reaches another mayor's city. Its bottom row is real rail, so trains run through it.
 */
export const GRAND_CENTRAL = {
  unlock: 'Connect your rail network to another mayor\'s city',
  benefits: [
    'Homes and businesses within 20 tiles count as served by rail: fewer car trips',
    'Rail-linked neighbours bring 50% more demand',
    'Built over an east-west rail line: the track stays, and trains run through',
  ],
};
/** A placed custom building: kind and footprint top-left. */
export interface CustomBuilding { kind: string; x: number; y: number }
