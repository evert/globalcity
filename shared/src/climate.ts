import { TRAFFIC_RAIL_SHARE } from './constants.ts';

// The world's climate, a deliberately small model stepped once a game year:
//   emissions  coal plants, industry and car traffic emit CO2; wind, offshore wind and nuclear don't. Forests hold
//              carbon: clearing trees releases it at once, new trees take it back up slowly as they grow
//   CO2        a stock in the air: about half of each year's emissions is taken up at once by oceans and plants,
//              and the excess over pre-industrial levels drains away slowly (centuries)
//   warming    the temperature drifts toward the equilibrium for the CO2 in the air (CLIMATE_SENSITIVITY per
//              doubling) with an ocean lag of decades
// Together that gives the real shape: emissions can drop fast, CO2 peaks and then falls slowly, and the
// temperature levels off rather than coming back down (the falling CO2 and the ocean still catching up cancel).
// Magnitudes are realistic per plant. The game's economy is far smaller than Earth's, so its atmosphere is too
// (AIR_SCALE): a handful of cities barely registers, hundreds of coal-burning cities warm the world within a century.

/** CO2 in the air before industry, and at the start of the game's calendar (1900), in ppm. */
export const PREINDUSTRIAL_PPM = 280;
export const START_PPM = 296;
/** Equilibrium warming for a doubling of CO2, degC. */
export const CLIMATE_SENSITIVITY = 3;
/** Years for the temperature to close most of the gap to its equilibrium (the oceans warming up). */
export const OCEAN_LAG_YEARS = 40;
/** Share of a year's emissions taken up straight away by oceans and plants. */
export const QUICK_SINK = 0.5;
/** Share of the excess CO2 over pre-industrial drained each year (slow ocean mixing). */
export const SLOW_SINK = 0.005;
/** Gigatonnes of CO2 that raise Earth's air by one ppm. */
export const GT_PER_PPM = 7.8;
/**
 * How much smaller the game's atmosphere is than Earth's. Fixed, so it depends only on what the world emits, never on
 * how many players there are. At 8 (measured on real saves, all emitting at their current rate): 6 cities stay near
 * 0 degC; 855 cities warm ~0.7 degC in 50 game years and ~1.7 in 100; 3,500 cities ~1.4 and ~3.1.
 */
export const AIR_SCALE = 8;
/** Megatonnes of CO2 a year: a coal plant (400 MW running ~60% of the time: ~2.1 TWh at ~0.95 t of CO2 per MWh),
 *  and an industrial zone. */
export const COAL_PLANT_MT = 2;
export const INDUSTRY_ZONE_MT = 0.02;
/** Tonnes of CO2 a resident's car trips emit a year (car-heavy cities; road transport averages ~1 t a person in the
 *  real world, over 2 t in the US). Homes with rail nearby make TRAFFIC_RAIL_SHARE of their trips by train. */
export const TRAFFIC_T_PER_PERSON = 2;
/** Megatonnes of CO2 a tree tile holds (~4 hectares of forest at ~600 t of CO2 a hectare). */
export const FOREST_MT_PER_TILE = 0.0024;
/** Share of the gap a growing forest closes each year (about two thirds of its carbon back in 50 years, ~90% in 100). */
export const FOREST_GROWTH = 0.02;

/** A year's emissions by source, megatonnes of CO2 (land: forests, negative while they grow back). */
export interface Emissions {
  power: number;
  industry: number;
  traffic: number;
  land: number;
}
export const totalEmissions = (e: Emissions): number => e.power + e.industry + e.traffic + e.land;

/** Power, industry and traffic from what stands in the world (land comes from forestYear). */
export function builtEmissions(coalPlants: number, industryZones: number, residents: number, railResidents: number): Omit<Emissions, 'land'> {
  return {
    power: coalPlants * COAL_PLANT_MT,
    industry: industryZones * INDUSTRY_ZONE_MT,
    traffic: ((residents - railResidents * TRAFFIC_RAIL_SHARE) * TRAFFIC_T_PER_PERSON) / 1e6,
  };
}

/** A year of forest carbon: trees lost release their carbon at once; new trees take it up as they grow.
 *  Returns the new stock and the year's net emissions (negative when the forests take CO2 up). */
export function forestYear(stock: number, treeTiles: number): { stock: number; land: number } {
  const target = treeTiles * FOREST_MT_PER_TILE;
  if (target <= stock) return { stock: target, land: stock - target };
  const uptake = (target - stock) * FOREST_GROWTH;
  return { stock: stock + uptake, land: -uptake };
}

export interface ClimateState {
  /** CO2 in the air, ppm */
  co2: number;
  /** temperature relative to pre-industrial, degC */
  temp: number;
  /** CO2 emitted in the last year, megatonnes */
  emissions: number;
  /** carbon held by the world's forests, megatonnes of CO2 (absent until first measured) */
  forest?: number;
  /** the last measured emissions by source (absent until first measured) */
  sources?: Emissions;
}

/** Equilibrium temperature (relative to pre-industrial) for a CO2 level. */
export const equilibriumTemp = (co2: number): number => CLIMATE_SENSITIVITY * Math.log2(co2 / PREINDUSTRIAL_PPM);

/** The climate when the calendar starts. */
export const startClimate = (): ClimateState => ({ co2: START_PPM, temp: equilibriumTemp(START_PPM), emissions: 0 });

/** Warming since the calendar started, degC. */
export const warming = (s: ClimateState): number => s.temp - equilibriumTemp(START_PPM);

/** A year's emissions in megatonnes, from what stands in the world. */
export const yearEmissions = (coalPlants: number, industryZones: number): number => coalPlants * COAL_PLANT_MT + industryZones * INDUSTRY_ZONE_MT;

/** One year on: add the year's emissions, let the sinks work, move the temperature toward equilibrium. */
export function climateYear(s: ClimateState, emissionsMt: number): ClimateState {
  let co2 = s.co2 + ((emissionsMt / 1000) * (1 - QUICK_SINK) * AIR_SCALE) / GT_PER_PPM;
  co2 -= (co2 - PREINDUSTRIAL_PPM) * SLOW_SINK;
  const temp = s.temp + (equilibriumTemp(co2) - s.temp) / OCEAN_LAG_YEARS;
  return { co2, temp, emissions: emissionsMt };
}
