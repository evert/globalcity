// Zoomed-out "map view": one pixel per tile, coloured by what the tile is (see maptiles.ts, which renders
// it into images for the client).
import * as T from './tiles.ts';

export enum OvClass {
  Dirt, Water, Trees, Park, Road, Traffic, Rail, Wire, Res, Com, Ind, Civic, Power, Special, Rubble, Fire,
}

/** RGB per class. Terrain matches the Micropolis tile art; buildings use map-view colours that stay distinct. */
export const OVERVIEW_PALETTE: readonly (readonly [number, number, number])[] = [
  [0xcc, 0x7f, 0x66], // Dirt (tile dirt)
  [0x66, 0x66, 0xe6], // Water (tile water)
  [0x00, 0xb8, 0x00], // Trees
  [0x3c, 0xe0, 0x3c], // Park
  [0x3f, 0x3f, 0x3f], // Road
  [0x8a, 0x2a, 0x1e], // Road with heavy-ish traffic
  [0x99, 0x7f, 0x4c], // Rail (tile rail ties)
  [0xe8, 0xe0, 0x60], // Power line
  [0x8c, 0xe6, 0x6a], // Residential
  [0x5a, 0x7c, 0xff], // Commercial
  [0xf2, 0xc9, 0x3a], // Industrial
  [0xff, 0x7a, 0xb4], // Civic: fire/police stations, hospital, church
  [0xff, 0x8a, 0x1a], // Power plants
  [0xd8, 0xd8, 0xd8], // Stadium, seaport, airport
  [0x80, 0x5c, 0x4a], // Rubble
  [0xff, 0x30, 0x10], // Fire
];

/** Darker "speck" variant used for terrain texture (every few tiles), like the specks in the tile art. */
export const OVERVIEW_SPECK: readonly (readonly [number, number, number])[] = OVERVIEW_PALETTE.map(([r, g, b], i) =>
  i === OvClass.Dirt ? [0x99, 0x5c, 0x48] : i === OvClass.Water ? [0x33, 0x33, 0xc8] : i === OvClass.Trees ? [0x00, 0x7f, 0x00] : [r, g, b]);

export function overviewClass(v: number): OvClass {
  const id = v & T.LOMASK;
  if (id >= T.FIRE && id <= T.LASTFIRE) return OvClass.Fire;
  if (id >= T.WATER_LOW && id <= T.WATER_HIGH) return OvClass.Water;
  if (id >= T.WOODS2 && id <= T.WOODS5 || id === T.FOUNTAIN || (id >= T.FOUNTAIN && id <= T.FOUNTAIN + 3)) return OvClass.Park;
  if (id >= T.WOODS_LOW && id <= T.WOODS_HIGH) return OvClass.Trees;
  if (id >= T.RUBBLE && id <= T.LASTRUBBLE) return OvClass.Rubble;
  if (id >= T.HTRFBASE && id <= T.LASTROAD) return OvClass.Traffic;
  if (T.isRoad(v)) return OvClass.Road;
  if (T.isRail(v)) return OvClass.Rail;
  if (T.isWire(v)) return OvClass.Wire;
  if (id >= T.HOUSE && id <= T.HHTHR) return OvClass.Res;
  if (id >= T.RESBASE && id < T.HOSPITALBASE) return OvClass.Res;
  if (id >= T.HOSPITALBASE && id < T.COMBASE) return OvClass.Civic;
  if (id >= T.COMBASE && id <= T.COMLAST) return OvClass.Com;
  if (id >= T.INDBASE && id <= T.INDLAST) return OvClass.Ind;
  if ((id >= T.COALBASE && id <= T.LASTPOWERPLANT) || (id >= T.NUCLEARBASE && id <= T.LASTZONE)) return OvClass.Power;
  if (id >= T.FIRESTBASE && id < T.STADIUMBASE) return OvClass.Civic;
  if (id >= T.CITYHALLBASE && id <= T.LASTCITYHALL) return OvClass.Civic;
  if (id >= T.SCHOOLBASE && id <= T.LASTSCHOOL) return OvClass.Civic;
  if (id >= T.WINDBASE && id <= T.LASTWIND) return OvClass.Power;
  if (id >= T.OFFSHOREBASE && id <= T.LASTOFFSHORE) return OvClass.Water;
  if (id === T.CUSTOMFILL || id === T.CUSTOMCENTRE) return OvClass.Civic;
  if ((id >= T.PORTBASE && id <= T.LASTAIRPORT) || (id >= T.STADIUMBASE && id < T.NUCLEARBASE)) return OvClass.Special;
  // animated building cells (smoke, radar, stadium game, swirl) belong to their buildings
  if (id >= T.COALSMOKE1 && id < T.COALSMOKE4 + 4) return OvClass.Power;
  if (id >= T.NUKESWIRL1 && id <= T.NUKESWIRL4) return OvClass.Power;
  if (id >= T.SMOKEBASE && id < T.SMOKEBASE + 8 || (id >= 884 && id <= 915)) return OvClass.Ind;
  if (id >= T.RADAR0 && id <= T.RADAR7 || (id >= T.FOOTBALLGAME1 && id < T.FOOTBALLGAME2 + 8)) return OvClass.Special;
  return OvClass.Dirt;
}

/** Flag on a class byte: a building that stays dark at night (no power, or a zone with nothing built yet). */
export const OV_DARK = 0x40;
/** The class bits of an overview byte. */
export const OV_CLASS_MASK = 0x3f;
const LIT_CLASSES = new Set([OvClass.Res, OvClass.Com, OvClass.Ind, OvClass.Civic, OvClass.Power, OvClass.Special]);
const isEmptyZone = (id: number): boolean =>
  (id >= T.RESBASE && id < T.HOUSE) || (id >= T.COMBASE && id < T.COMBASE + 9) || (id >= T.INDBASE && id < T.INDBASE + 9);

/** The overview byte for a tile: its class, plus OV_DARK for a building without power or an empty zone. */
export function overviewByte(v: number): number {
  const c = overviewClass(v);
  return LIT_CLASSES.has(c) && (!(v & T.PWRBIT) || isEmptyZone(v & T.LOMASK)) ? c | OV_DARK : c;
}
