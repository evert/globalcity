// Settings that tests change at runtime (the devConfig dev hook, see net.ts). Each defaults to its environment
// variable, else the game's own value, so production and the dev servers behave as they always did:
//
//   SEASON_MONTH           1..12: pretend it is this month for seasonal buildings; default the real month (UTC)
//   ABANDON_DAY_MS         length of an abandonment "day" in ms (default 86400000)
//   CITY_FREEZE_MS         a city freezes once its mayor has been away this long (default CITY_FREEZE_MS)
//   SMALL_CITY_RELEASE_MS  a small city is released once its mayor has been away this long (default SMALL_CITY_RELEASE_MS)
//   REGROW_MS, REGROW_P    how often rubble may turn back into landscape, and the chance per tile (defaults REGROW_MS, REGROW_P)
//   MONUMENT_MIN_POP       population a city needs to become a monument (default MONUMENT_MIN_POP)
//   DISASTER_EVERY_MS      a disaster strikes this often instead of the usual random gaps (0 = the usual)
import { CITY_FREEZE_MS, SMALL_CITY_RELEASE_MS, REGROW_MS, REGROW_P, MONUMENT_MIN_POP } from '@globalcity/shared';

export interface Config {
  /** 1..12, or null for the real month */
  seasonMonth: number | null;
  abandonDayMs: number;
  cityFreezeMs: number;
  smallCityReleaseMs: number;
  regrowMs: number;
  regrowP: number;
  monumentMinPop: number;
  disasterEveryMs: number;
}

const envMonth = (): number | null => {
  const m = Number(process.env.SEASON_MONTH);
  return Number.isInteger(m) && m >= 1 && m <= 12 ? m : null;
};
const envNum = (name: string, dflt: number): number => Number(process.env[name]) || dflt;

/** The settings as the environment gives them. */
export function configFromEnv(): Config {
  return {
    seasonMonth: envMonth(),
    abandonDayMs: envNum('ABANDON_DAY_MS', 86_400_000),
    cityFreezeMs: envNum('CITY_FREEZE_MS', CITY_FREEZE_MS),
    smallCityReleaseMs: envNum('SMALL_CITY_RELEASE_MS', SMALL_CITY_RELEASE_MS),
    regrowMs: envNum('REGROW_MS', REGROW_MS),
    regrowP: envNum('REGROW_P', REGROW_P),
    monumentMinPop: envNum('MONUMENT_MIN_POP', MONUMENT_MIN_POP),
    disasterEveryMs: envNum('DISASTER_EVERY_MS', 0),
  };
}

/** The live settings: read them where they are used, never copy them into a constant. */
export const config: Config = configFromEnv();

/** Back to the environment's settings (devReset). */
export function resetConfig(): void {
  Object.assign(config, configFromEnv());
}

/** Change some settings (devConfig). Returns an error message, changing nothing, if any value is invalid. */
export function updateConfig(patch: Record<string, unknown>): string | null {
  const next: Config = { ...config };
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in config)) return `unknown setting ${k}`;
    if (k === 'seasonMonth') {
      if (v !== null && !(Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 12)) return 'seasonMonth must be 1..12 or null';
      next.seasonMonth = v as number | null;
    } else if (k === 'regrowP') {
      if (typeof v !== 'number' || !(v > 0 && v <= 1)) return 'regrowP must be in (0, 1]';
      next.regrowP = v;
    } else {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || (v === 0 && k !== 'disasterEveryMs')) return `${k} must be a positive number`;
      (next as unknown as Record<string, number>)[k] = v;
    }
  }
  Object.assign(config, next);
  return null;
}
