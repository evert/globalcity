// The world's climate, a deliberately small model stepped once a game year:
//   emissions  coal plants and industry emit CO2; wind, offshore wind and nuclear don't
//   CO2        a stock in the air: about half of each year's emissions is taken up at once by oceans and plants,
//              and the excess over pre-industrial levels drains away slowly (centuries)
//   warming    the temperature drifts toward the equilibrium for the CO2 in the air (CLIMATE_SENSITIVITY per
//              doubling) with an ocean lag of decades
// Together that gives the real shape: emissions can drop fast, CO2 peaks and then falls slowly, and the
// temperature levels off rather than coming back down (the falling CO2 and the ocean still catching up cancel).
// Magnitudes are realistic per plant; the game's world is far smaller than Earth's economy, so warming is modest.

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
/** Gigatonnes of CO2 that raise the air's CO2 by one ppm. */
export const GT_PER_PPM = 7.8;
/** Megatonnes of CO2 a year: a coal plant (400 MW running ~60% of the time: ~2.1 TWh at ~0.95 t of CO2 per MWh),
 *  and an industrial zone. */
export const COAL_PLANT_MT = 2;
export const INDUSTRY_ZONE_MT = 0.02;

export interface ClimateState {
  /** CO2 in the air, ppm */
  co2: number;
  /** temperature relative to pre-industrial, degC */
  temp: number;
  /** CO2 emitted in the last year, megatonnes */
  emissions: number;
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
  let co2 = s.co2 + ((emissionsMt / 1000) * (1 - QUICK_SINK)) / GT_PER_PPM;
  co2 -= (co2 - PREINDUSTRIAL_PPM) * SLOW_SINK;
  const temp = s.temp + (equilibriumTemp(co2) - s.temp) / OCEAN_LAG_YEARS;
  return { co2, temp, emissions: emissionsMt };
}
