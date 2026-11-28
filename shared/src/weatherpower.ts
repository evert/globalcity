// The weather in the simulation (server/src/weather.ts has it; the simulation asks each step): wind farms follow the
// real wind and solar farms the real sun and clouds, hour by hour (coal and nuclear don't care); snow on the roads
// slows the traffic; heavy rain makes floods likelier.
// When there is no weather (not fetched yet, or turned off) wind runs at a typical share and solar assumes a half
// cloudy sky; solar still follows the sun, so it makes nothing at night either way.

/** Peak output, MW: wind and offshore at full wind, solar with the sun overhead in a clear sky. */
export const WIND_PEAK = 200;
export const OFFSHORE_PEAK = 150;
export const SOLAR_PEAK = 150;
/** Shares of the peak without weather: what a wind farm makes on a typical day (40 MW, offshore 60 MW). */
export const WIND_TYPICAL_SHARE = 0.2;
export const OFFSHORE_TYPICAL_SHARE = 0.4;
/** ... and the cloud cover solar assumes. */
export const TYPICAL_CLOUD = 0.5;
/** A solar farm's output averaged over a day and night at mid latitudes (for labels: about 30 MW). */
export const SOLAR_TYPICAL_SHARE = 0.2;

/** How snowy a place's roads are, 0..1: snow lying (full from 10 cm) or falling (at least half). */
export function snowOnRoads(snowDepth: number, snowing: boolean): number {
  return Math.max(Math.min(1, Math.max(0, snowDepth) / 0.1), snowing ? 0.5 : 0);
}
/** Snowy roads make drives this much slower at most: more cars on the road at once, so more traffic. */
export const SNOW_TRAFFIC = 0.6;
/** Rain this heavy (mm/h) makes a flood five times as likely in a city that can flood; lighter rain less so. */
export const FLOOD_RAIN_MM_H = 8;

/**
 * Share (0..1) of a wind farm's peak at a 10 m wind speed (m/s, averaged over a weather grid square). Turbine hubs,
 * ~100 m up, see ~35% more wind (offshore ~15%: less friction over water). The wind within a grid square varies, so
 * this is the average output of turbines whose mean wind is that speed (a capacity-factor curve), not one turbine's
 * power curve: ~17% at a 5 m/s hub mean, ~43% at 8, 60% from 10. In a storm (over 20 m/s at 10 m) they shut down.
 */
export function windShare(wind10: number, offshore: boolean): number {
  if (!(wind10 >= 0) || wind10 > 20) return 0;
  const hub = wind10 * (offshore ? 1.15 : 1.35);
  return Math.min(0.6, Math.max(0, 0.085 * (hub - 3)));
}

/**
 * Share (0..1) of a solar farm's peak: the sun's height (nothing below the horizon, full with the sun overhead, less
 * through the thicker air when it is low) times what the clouds let through (Kasten and Czeplak: an overcast sky lets
 * about a quarter through).
 */
export function solarShare(sunElevationDeg: number, cloud: number): number {
  if (!(sunElevationDeg > 0)) return 0;
  const c = Math.min(1, Math.max(0, cloud));
  return Math.pow(Math.sin((sunElevationDeg * Math.PI) / 180), 1.2) * (1 - 0.75 * Math.pow(c, 3.4));
}
