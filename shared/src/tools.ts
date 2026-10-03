import * as T from './tiles.ts';

export type ToolId =
  | 'query' | 'bulldozer' | 'road' | 'rail' | 'wire' | 'park'
  | 'residential' | 'commercial' | 'industrial'
  | 'fire' | 'police' | 'coal' | 'nuclear' | 'stadium' | 'seaport' | 'airport';

export interface ToolDef {
  id: ToolId;
  name: string;
  cost: number;
  /** footprint side in tiles; 1 for single-tile tools */
  size: 1 | 3 | 4 | 6;
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
  wire:        { id: 'wire',        name: 'Power line',        cost: 5,     size: 1, hotkey: 'w', icon: T.LHPOWER },
  park:        { id: 'park',        name: 'Park',              cost: 10,    size: 1, hotkey: 'p', icon: T.WOODS },
  residential: { id: 'residential', name: 'Residential zone',  cost: 100,   size: 3, base: T.RESBASE,      hotkey: '1', icon: T.FREEZ },
  commercial:  { id: 'commercial',  name: 'Commercial zone',   cost: 100,   size: 3, base: T.COMBASE,      hotkey: '2', icon: T.COMCLR },
  industrial:  { id: 'industrial',  name: 'Industrial zone',   cost: 100,   size: 3, base: T.INDBASE,      hotkey: '3', icon: T.INDCLR },
  fire:        { id: 'fire',        name: 'Fire station',      cost: 500,   size: 3, base: T.FIRESTBASE,   hotkey: 'f', icon: T.FIRESTATION },
  police:      { id: 'police',      name: 'Police station',    cost: 500,   size: 3, base: T.POLICESTBASE, hotkey: 'l', icon: T.POLICESTATION },
  coal:        { id: 'coal',        name: 'Coal power plant',  cost: 3000,  size: 4, base: T.COALBASE,     hotkey: 'c', icon: T.POWERPLANT },
  nuclear:     { id: 'nuclear',     name: 'Nuclear plant',     cost: 5000,  size: 4, base: T.NUCLEARBASE,  hotkey: 'n', icon: T.NUCLEAR },
  stadium:     { id: 'stadium',     name: 'Stadium',           cost: 5000,  size: 4, base: T.STADIUMBASE,  hotkey: 's', icon: T.STADIUM },
  seaport:     { id: 'seaport',     name: 'Seaport',           cost: 3000,  size: 4, base: T.PORTBASE,     hotkey: 'o', icon: T.PORT },
  airport:     { id: 'airport',     name: 'Airport',           cost: 10000, size: 6, base: T.AIRPORTBASE,  hotkey: 'a', icon: T.AIRPORT },
};

export const TOOL_ORDER: ToolId[] = [
  'query', 'bulldozer', 'road', 'rail', 'wire', 'park',
  'residential', 'commercial', 'industrial',
  'fire', 'police', 'coal', 'nuclear', 'stadium', 'seaport', 'airport',
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
export function footprintOrigin(tool: ToolDef, x: number, y: number): { x0: number; y0: number } {
  if (tool.size === 1) return { x0: x, y0: y };
  return { x0: x - 1, y0: y - 1 };
}

/** Power produced per plant, in zone-units (Micropolis values). */
export const COAL_POWER = 700;
export const NUCLEAR_POWER = 2000;
