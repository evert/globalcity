// The climate model's shape: emissions raise CO2 and warm the world; when they stop, CO2 falls slowly and the
// temperature levels off instead of coming back down.
import { describe, it, expect } from 'vitest';
import { startClimate, climateYear, warming, yearEmissions, equilibriumTemp, START_PPM, type ClimateState } from '../src/climate.ts';

const run = (s: ClimateState, years: number, mt: number): ClimateState => {
  for (let i = 0; i < years; i++) s = climateYear(s, mt);
  return s;
};

describe('climate model', () => {
  it('starts in 1900 with no warming', () => {
    const s = startClimate();
    expect(s.co2).toBe(START_PPM);
    expect(warming(s)).toBe(0);
  });

  it('a world without emissions stays close to where it started', () => {
    const s = run(startClimate(), 100, 0);
    expect(s.co2).toBeLessThan(START_PPM);
    expect(Math.abs(warming(s))).toBeLessThan(0.2);
  });

  it('emissions raise CO2 and warm the world, behind the equilibrium', () => {
    const mt = yearEmissions(2000, 20000); // 2,000 coal plants and 20,000 factories: 10.4 Gt a year
    expect(mt).toBe(10_400);
    const s = run(startClimate(), 100, mt);
    expect(s.co2).toBeGreaterThan(START_PPM + 40);
    expect(warming(s)).toBeGreaterThan(0.3);
    expect(s.temp).toBeLessThan(equilibriumTemp(s.co2)); // the ocean still catching up
    expect(s.emissions).toBe(mt);
  });

  it('after a switch to clean power, CO2 falls slowly and the warming levels off', () => {
    const peak = run(startClimate(), 100, 10_400);
    const later = run(peak, 100, 0);
    expect(later.co2).toBeLessThan(peak.co2);
    expect(later.co2).toBeGreaterThan(START_PPM); // slowly: not back to where it started
    expect(Math.abs(warming(later) - warming(peak))).toBeLessThan(0.25); // roughly flat, not undone
  });
});
