// Power from the weather (weatherpower.ts): the shapes the game relies on.
import { describe, it, expect } from 'vitest';
import {
  snowOnRoads,
  windShare,
  solarShare,
  WIND_PEAK,
  WIND_TYPICAL_SHARE,
  OFFSHORE_PEAK,
  OFFSHORE_TYPICAL_SHARE,
  WIND_POWER,
  OFFSHORE_POWER,
} from '../src/index.ts';

describe('wind', () => {
  it('nothing in a calm, more as it blows, capped at 60%, off in a storm', () => {
    expect(windShare(0, false)).toBe(0);
    expect(windShare(2, false)).toBe(0); // a 2.7 m/s hub wind: below cut-in
    expect(windShare(4, false)).toBeGreaterThan(0.1);
    expect(windShare(6, false)).toBeGreaterThan(windShare(4, false));
    expect(windShare(9, false)).toBe(0.6);
    expect(windShare(19, false)).toBe(0.6);
    expect(windShare(21, false)).toBe(0); // shut down in a storm
  });

  it('offshore turbines see less wind shear but steadier wind; typical days match the old fixed output', () => {
    expect(windShare(5, true)).toBeLessThan(windShare(5, false));
    expect(WIND_POWER).toBe(Math.round(WIND_PEAK * WIND_TYPICAL_SHARE));
    expect(WIND_POWER).toBe(40);
    expect(OFFSHORE_POWER).toBe(Math.round(OFFSHORE_PEAK * OFFSHORE_TYPICAL_SHARE));
    expect(OFFSHORE_POWER).toBe(60);
  });
});

describe('solar', () => {
  it('nothing at night, most with the sun high in a clear sky, a quarter under overcast', () => {
    expect(solarShare(-10, 0)).toBe(0);
    expect(solarShare(0, 0)).toBe(0);
    expect(solarShare(90, 0)).toBeCloseTo(1);
    expect(solarShare(30, 0)).toBeLessThan(solarShare(60, 0));
    expect(solarShare(90, 1)).toBeCloseTo(0.25);
    expect(solarShare(90, 0.5)).toBeGreaterThan(0.9); // a half cloudy sky barely dims it
  });
});

describe('snow on the roads', () => {
  it('lying snow counts fully from 10 cm; falling snow at least half', () => {
    expect(snowOnRoads(0, false)).toBe(0);
    expect(snowOnRoads(0.05, false)).toBeCloseTo(0.5);
    expect(snowOnRoads(0.5, false)).toBe(1);
    expect(snowOnRoads(0, true)).toBe(0.5);
    expect(snowOnRoads(0.08, true)).toBeCloseTo(0.8);
  });
});
