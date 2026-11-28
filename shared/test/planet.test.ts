// The Moon (planet.ts): the sun follows the lunar phase, night falls without twilight, and cities are moon bases.
// configurePlanet can't be undone, so this file has the Moon to itself (vitest runs each file on its own).
import { describe, it, expect } from 'vitest';
import {
  configurePlanet,
  subsolarPoint,
  nightLevel,
  TOOLS,
  MILESTONE_LADDER,
  moonName,
  MAP_PALETTE,
  MAP_MOON_BASE,
  mapIndex,
  Biome,
  DIRT,
  PLANET,
} from '../src/index.ts';

describe('the Moon', () => {
  it('starts as the Earth', () => {
    expect(PLANET).toBe('earth');
    expect(mapIndex(DIRT, Biome.Temperate)).not.toBe(MAP_MOON_BASE);
  });

  it('the sun is overhead on the near side at full moon and on the far side at new moon', () => {
    configurePlanet('moon');
    const full = subsolarPoint(Date.parse('2026-11-24T14:53Z')),
      fresh = subsolarPoint(Date.parse('2026-12-09T00:52Z'));
    expect(Math.abs(full.lon)).toBeLessThan(3);
    expect(180 - Math.abs(fresh.lon)).toBeLessThan(3);
    expect(Math.abs(full.lat)).toBeLessThanOrEqual(1.6);
  });

  it('no twilight: dark a degree below the horizon', () => {
    expect(nightLevel(1)).toBe(0);
    expect(nightLevel(-1)).toBe(1);
  });

  it('a city is a moon base: other names, no seaport or offshore wind', () => {
    expect(TOOLS.residential.name).toBe('Habitat zone');
    expect(TOOLS.windfarm.name).toBe('Solar array');
    expect(MILESTONE_LADDER).not.toContain('seaport');
    expect(MILESTONE_LADDER).not.toContain('offshore');
    expect(moonName('Residential zone (empty)')).toBe('Habitat zone (empty)');
    expect(moonName('Road')).toBe('Road');
  });

  it('the ground is grey regolith on the map', () => {
    const [r, g, b] = MAP_PALETTE[mapIndex(DIRT, Biome.Temperate)];
    expect(mapIndex(DIRT, Biome.Temperate)).toBe(MAP_MOON_BASE + Biome.Temperate * 4);
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(12);
  });
});
