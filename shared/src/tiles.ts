// Tile numbering, flag bits and connection tables follow Micropolis
// (the GPLv3 release of SimCity Classic by Electronic Arts / Don Hopkins).
// See ATTRIBUTION.md. Values verified against MicropolisCore/src/MicropolisEngine/src micropolis.h,
// connect.cpp (Road/Rail/WireTable), generate.cpp and zone.cpp. Note: the engine's COMLAST is 609;
// 611 is kept here because tiles 610-611 belong to the last commercial building.

// ---- flag bits (upper 6 bits of a uint16 tile) ----
export const LOMASK = 0x03ff; // tile id mask
export const ZONEBIT = 0x0400; // tile is the centre/hot-spot of a zone or building
export const ANIMBIT = 0x0800; // tile is animated
export const BULLBIT = 0x1000; // tile is bulldozable
export const BURNBIT = 0x2000; // tile is burnable
export const CONDBIT = 0x4000; // tile conducts power
export const PWRBIT = 0x8000; // tile is powered
export const ALLBITS = 0xfc00;
export const BLBNBIT = BULLBIT | BURNBIT;
export const BLBNCNBIT = BULLBIT | BURNBIT | CONDBIT;
export const BNCNBIT = BURNBIT | CONDBIT;

// ---- terrain ----
export const DIRT = 0;
export const RIVER = 2;
export const REDGE = 3;
export const CHANNEL = 4;
export const FIRSTRIVEDGE = 5;
export const LASTRIVEDGE = 20;
export const WATER_LOW = RIVER;
export const WATER_HIGH = LASTRIVEDGE;
export const TREEBASE = 21;
export const WOODS_LOW = TREEBASE;
export const LASTTREE = 36;
export const WOODS = 37;
export const WOODS_HIGH = 39;
export const WOODS2 = 40;
export const WOODS3 = 41;
export const WOODS4 = 42;
export const WOODS5 = 43;
export const RUBBLE = 44;
export const LASTRUBBLE = 47;
export const FLOOD = 48;
export const LASTFLOOD = 51;
export const RADTILE = 52;
export const FIRE = 56;
export const FIREBASE = FIRE;
export const LASTFIRE = 63;

// ---- roads ----
export const HBRIDGE = 64;
export const ROADBASE = HBRIDGE;
export const VBRIDGE = 65;
export const ROADS = 66; // horizontal
export const ROADS2 = 67; // vertical
export const ROADS3 = 68;
export const ROADS4 = 69;
export const ROADS5 = 70;
export const ROADS6 = 71;
export const ROADS7 = 72;
export const ROADS8 = 73;
export const ROADS9 = 74;
export const ROADS10 = 75;
export const INTERSECTION = 76;
export const HROADPOWER = 77;
export const VROADPOWER = 78;
export const BRWH = 79;
export const LTRFBASE = 80; // light traffic
export const BRWV = 95;
export const HTRFBASE = 144; // heavy traffic
export const LASTROAD = 206;

// ---- power lines ----
export const HPOWER = 208; // underwater power line; NB: the art runs north-south despite the Micropolis name
export const POWERBASE = HPOWER;
export const VPOWER = 209; // underwater power line; NB: the art runs east-west despite the Micropolis name
export const LHPOWER = 210;
export const LVPOWER = 211;
export const LVPOWER2 = 212;
export const LVPOWER3 = 213;
export const LVPOWER4 = 214;
export const LVPOWER5 = 215;
export const LVPOWER6 = 216;
export const LVPOWER7 = 217;
export const LVPOWER8 = 218;
export const LVPOWER9 = 219;
export const LVPOWER10 = 220;
export const RAILHPOWERV = 221;
export const RAILVPOWERH = 222;
export const POWER_LOW = POWERBASE;
export const POWER_HIGH = RAILVPOWERH;
export const LASTPOWER = RAILVPOWERH;

// ---- rail ----
export const HRAIL = 224;
export const RAILBASE = HRAIL;
export const VRAIL = 225;
export const LHRAIL = 226;
export const LVRAIL = 227;
export const LVRAIL2 = 228;
export const LVRAIL3 = 229;
export const LVRAIL4 = 230;
export const LVRAIL5 = 231;
export const LVRAIL6 = 232;
export const LVRAIL7 = 233;
export const LVRAIL8 = 234;
export const LVRAIL9 = 235;
export const LVRAIL10 = 236;
export const HRAILROAD = 237;
export const VRAILROAD = 238;
export const RAIL_LOW = RAILBASE;
export const RAIL_HIGH = VRAILROAD;
export const LASTRAIL = VRAILROAD;

// ---- zones ----
export const RESBASE = 240; // 3x3 empty residential zone, centre = FREEZ
export const FREEZ = 244;
export const HOUSE = 249; // 12 single-tile houses (249..260) that grow inside an empty res zone
export const LHTHR = HOUSE;
export const HHTHR = 260;
export const RZB = 265; // centre of first full residential building; 16 variants (4 density x 4 value) of 9 tiles
export const HOSPITALBASE = 405;
export const HOSPITAL = 409;
export const CHURCHBASE = 414;
export const CHURCH = 418;
export const COMBASE = 423; // 3x3 empty commercial zone, centre = COMCLR
export const COMCLR = 427;
export const CZB = 436; // centre of first commercial building; 20 variants (5 density x 4 value)
export const COMLAST = 611;
export const INDBASE = 612; // 3x3 empty industrial zone, centre = INDCLR
export const INDCLR = 616;
export const IZB = 625; // centre of first industrial building; 8 variants (4 density x 2 value)
export const INDLAST = 692;
export const PORTBASE = 693; // 4x4
export const PORT = 698;
export const LASTPORT = 708;
export const AIRPORTBASE = 709; // 6x6
export const RADAR = 711;
export const AIRPORT = 716;
export const LASTAIRPORT = 744;
export const COALBASE = 745; // 4x4
export const POWERPLANT = 750;
export const LASTPOWERPLANT = 760;
export const FIRESTBASE = 761; // 3x3
export const FIRESTATION = 765;
export const POLICESTBASE = 770; // 3x3
export const POLICESTATION = 774;
export const STADIUMBASE = 779; // 4x4
export const STADIUM = 784;
export const FULLSTADIUMBASE = 795;
export const FULLSTADIUM = 800;
export const NUCLEARBASE = 811; // 4x4
export const NUCLEAR = 816;
export const LASTZONE = 826;

// ---- animation / misc ----
export const LIGHTNINGBOLT = 827;
export const HBRDG0 = 828;
export const HBRDG3 = 831;
export const RADAR0 = 832;
export const RADAR7 = 839;
export const FOUNTAIN = 840;
export const INDBASE2 = 844;
export const TELEBASE = 844;
export const TELELAST = 851;
export const SMOKEBASE = 852;
export const TINYEXP = 860;
export const SOMETINYEXP = 864;
export const LASTTINYEXP = 867;
export const TINYEXPLAST = 883;
export const COALSMOKE1 = 916;
export const COALSMOKE2 = 920;
export const COALSMOKE3 = 924;
export const COALSMOKE4 = 928;
export const FOOTBALLGAME1 = 932;
export const FOOTBALLGAME2 = 940;
export const VBRDG0 = 948;
export const VBRDG3 = 951;
export const NUKESWIRL1 = 952;
export const NUKESWIRL4 = 955;
// GlobalCity additions after the original 960 Micropolis tiles (one 16-tile row each in tiles.png).
export const CITYHALLBASE = 960; // 4x4 city hall (art: art/prototype/civic/city_hall.py)
export const CITYHALL = 965; // centre (hot-spot at 1,1)
export const LASTCITYHALL = 975;
export const SCHOOLBASE = 976; // 3x3 elementary school (art/prototype/civic/school.py)
export const SCHOOL = 980;
export const LASTSCHOOL = 984;
export const WINDBASE = 985; // 4x4 wind farm (art/prototype/utilities/wind_farm.py)
export const WINDFARM = 990;
export const LASTWIND = 1000;
export const OFFSHOREBASE = 1001; // 4x4 offshore wind farm, built on water (art/prototype/utilities/offshore_wind.py)
export const OFFSHORE = 1006;
export const LASTOFFSHORE = 1016;
// Custom-building layer: buildings drawn as whole images (any width x height), not tile by tile. The world
// stores two generic tiles (the hot-spot tile at footprint offset (1,1) carries ZONEBIT, the rest are fill)
// and the server's building registry records each building's kind, position and size.
export const CUSTOMFILL = 1017;
export const CUSTOMCENTRE = 1018;
// Underwater power line corners (GlobalCity additions, drawn by art/sheet/build_sheet.py in the style of
// 208/209), named by the two sides they connect.
export const UWPOWER_NE = 1019;
export const UWPOWER_SE = 1020;
export const UWPOWER_SW = 1021;
export const UWPOWER_NW = 1022;
export const TILE_COUNT = 1023;
/** Any underwater power line piece: the two straights (208/209) or a corner. */
export const isUnderwaterWireId = (t: number): boolean => t === HPOWER || t === VPOWER || (t >= UWPOWER_NE && t <= UWPOWER_NW);

// ---- connection tables (index = N:1 | E:2 | S:4 | W:8 of same-kind neighbours) ----
export const ROAD_TABLE: readonly number[] = [
  ROADS, ROADS2, ROADS, ROADS3,
  ROADS2, ROADS2, ROADS4, ROADS8,
  ROADS, ROADS6, ROADS, ROADS7,
  ROADS5, ROADS10, ROADS9, INTERSECTION,
];
export const RAIL_TABLE: readonly number[] = [
  LHRAIL, LVRAIL, LHRAIL, LVRAIL2,
  LVRAIL, LVRAIL, LVRAIL3, LVRAIL7,
  LHRAIL, LVRAIL5, LHRAIL, LVRAIL6,
  LVRAIL4, LVRAIL9, LVRAIL8, LVRAIL10,
];
export const WIRE_TABLE: readonly number[] = [
  LHPOWER, LVPOWER, LHPOWER, LVPOWER2,
  LVPOWER, LVPOWER, LVPOWER3, LVPOWER7,
  LHPOWER, LVPOWER5, LHPOWER, LVPOWER6,
  LVPOWER4, LVPOWER9, LVPOWER8, LVPOWER10,
];

// Shoreline smoothing (generate.cpp smoothRiver, REdTab). Index bit set = neighbour is neither dirt nor woods,
// same N/E/S/W bit order as above. The engine applies it to REDGE tiles.
export const RIVER_EDGE_TABLE: readonly number[] = [
  13 | BULLBIT, 13 | BULLBIT, 17 | BULLBIT, 15 | BULLBIT,
  5 | BULLBIT, 2, 19 | BULLBIT, 17 | BULLBIT,
  9 | BULLBIT, 11 | BULLBIT, 2, 13 | BULLBIT,
  7 | BULLBIT, 9 | BULLBIT, 5 | BULLBIT, 2,
];
// Tree smoothing (generate.cpp smoothTrees). Index bit set = neighbour is woods.
// Result 0 means the tree is removed; result != WOODS gets -8 on odd (x+y) for variety.
export const TREE_EDGE_TABLE: readonly number[] = [0, 0, 0, 34, 0, 0, 36, 35, 0, 32, 0, 33, 30, 31, 29, 37];

// ---- helpers ----
export const tileId = (v: number): number => v & LOMASK;
export const isDirt = (v: number): boolean => (v & LOMASK) === DIRT;
export const isWater = (v: number): boolean => { const t = v & LOMASK; return t >= WATER_LOW && t <= WATER_HIGH; };
/** Number of non-water tiles in one chunk's tiles (CHUNK*CHUNK values, row-major). */
export const chunkLandCount = (tiles: ArrayLike<number>): number => {
  let n = 0;
  for (let i = 0; i < tiles.length; i++) { const t = tiles[i] & LOMASK; if (t < WATER_LOW || t > WATER_HIGH) n++; }
  return n;
};
export const isTree = (v: number): boolean => { const t = v & LOMASK; return t >= WOODS_LOW && t <= WOODS_HIGH; };
export const isRubble = (v: number): boolean => { const t = v & LOMASK; return t >= RUBBLE && t <= LASTRUBBLE; };
export const isRoad = (v: number): boolean => { const t = v & LOMASK; return t >= ROADBASE && t <= LASTROAD; };
export const isRail = (v: number): boolean => { const t = v & LOMASK; return (t >= RAIL_LOW && t <= RAIL_HIGH) || t === RAILHPOWERV || t === RAILVPOWERH; };
export const isWire = (v: number): boolean => { const t = v & LOMASK; return (t >= POWER_LOW && t <= POWER_HIGH) || t === HROADPOWER || t === VROADPOWER || (t >= UWPOWER_NE && t <= UWPOWER_NW); };
export const isZoneCenter = (v: number): boolean => (v & ZONEBIT) !== 0;
export const isPowered = (v: number): boolean => (v & PWRBIT) !== 0;
export const isConductive = (v: number): boolean => (v & CONDBIT) !== 0;
export const isBulldozable = (v: number): boolean => (v & BULLBIT) !== 0;
/** Infrastructure built over water: road bridges (incl. drawbridge pieces), underwater power lines and rail.
 *  Removing one must leave water behind, never land. */
export const isOverWater = (v: number): boolean => {
  const t = v & LOMASK;
  return t === HBRIDGE || t === VBRIDGE || t === BRWH || t === BRWV || isUnderwaterWireId(t)
    || t === HRAIL || t === VRAIL || (t >= HBRDG0 && t <= HBRDG3) || (t >= VBRDG0 && t <= VBRDG3);
};
export const isHouse = (v: number): boolean => { const t = v & LOMASK; return t >= HOUSE && t <= HHTHR; };
/** True for any tile that is part of a multi-tile zone/building (240..826, excluding single-tile houses). */
export const isZoneTile = (v: number): boolean => { const t = v & LOMASK; return (t >= RESBASE && t <= LASTZONE && !(t >= HOUSE && t <= HHTHR)) || (t >= CITYHALLBASE && t <= CUSTOMCENTRE); };
export const isResZone = (v: number): boolean => { const t = v & LOMASK; return t >= RESBASE && t <= HOSPITALBASE - 1; };
export const isComZone = (v: number): boolean => { const t = v & LOMASK; return t >= COMBASE && t <= COMLAST; };
export const isIndZone = (v: number): boolean => { const t = v & LOMASK; return t >= INDBASE && t <= INDLAST; };

/** Footprint side length of the building whose centre tile id is `t` (3, 4 or 6), or 0 if not a centre-able id. */
export function zoneSizeForCenter(t: number): number {
  t &= LOMASK;
  if (t >= PORTBASE && t <= LASTPORT) return 4;
  if (t >= CITYHALLBASE && t <= LASTCITYHALL) return 4;
  if (t >= SCHOOLBASE && t <= LASTSCHOOL) return 3;
  if (t >= WINDBASE && t <= LASTOFFSHORE) return 4;
  if (t >= AIRPORTBASE && t <= LASTAIRPORT) return 6;
  if (t >= COALBASE && t <= LASTPOWERPLANT) return 4;
  if (t >= STADIUMBASE && t <= FULLSTADIUMBASE + 15) return 4;
  if (t >= NUCLEARBASE && t <= LASTZONE) return 4;
  if (t >= RESBASE && t <= LASTZONE) return 3;
  return 0;
}

/** Residential building population (Micropolis getResZonePop). */
export const resZonePop = (centerTile: number): number => (Math.floor(((centerTile & LOMASK) - RZB) / 9) % 4) * 8 + 16;
/** Commercial building population (getComZonePop). */
export const comZonePop = (centerTile: number): number => (Math.floor(((centerTile & LOMASK) - CZB) / 9) % 5) + 1;
/** Industrial building population (getIndZonePop). */
export const indZonePop = (centerTile: number): number => (Math.floor(((centerTile & LOMASK) - IZB) / 9) % 4) + 1;

/** Centre tile id for a residential building of density 0..3 and land value 0..3. */
export const resBuildingCenter = (density: number, value: number): number => (value * 4 + density) * 9 + RZB;
/** Centre tile id for a commercial building of density 0..4 and land value 0..3. */
export const comBuildingCenter = (density: number, value: number): number => (value * 5 + density) * 9 + CZB;
/** Centre tile id for an industrial building of density 0..3 and land value 0..1. */
export const indBuildingCenter = (density: number, value: number): number => (value * 4 + density) * 9 + IZB;

/** Displayed city population from the three zone pop counters (Micropolis getPopulation). */
export const displayPopulation = (resPop: number, comPop: number, indPop: number): number => (resPop + (comPop + indPop) * 8) * 20;

/** Offshore wind farm tiles: built on water, revert to water (not rubble) when removed. */
export const isOffshoreTile = (v: number): boolean => { const t = v & LOMASK; return t >= OFFSHOREBASE && t <= LASTOFFSHORE; };
export const isCustomTile = (v: number): boolean => { const t = v & LOMASK; return t === CUSTOMFILL || t === CUSTOMCENTRE; };
