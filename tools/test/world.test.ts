// World generator tests: the generated Earth (npm run gen:world -> data/world-<W>x<H>/, see docs/world-format.md)
// has its files in the right shape and real geography where it should be. They read the files, no server; skipped
// when there is no generated world (the gameplay tests play on a fixture world and don't need one).
//   WORLD_DIR  another world directory to check (relative to the repo root)
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import {
  BASE_WATER,
  BASE_BIOME_MASK,
  Biome,
  CHUNK,
  CHUNKS_X,
  CHUNKS_Y,
  Disaster,
  EARTH_H,
  EARTH_W,
  MIN_LAND_TILES_FIRST_CLAIM,
  MIN_LAND_TILES_TO_CLAIM,
  WORLD_H,
  WORLD_W,
  baseIsFrozen,
  chunkOf,
  configureWorld,
  hazardBit,
  lonLatToTile,
} from '@globalcity/shared';

const root = path.resolve(import.meta.dirname, '../..');
const dir = path.resolve(root, process.env.WORLD_DIR || `data/world-${EARTH_W}x${EARTH_H}`);
// (vitest.config.ts says so when it is missing)
const present = fs.existsSync(path.join(dir, 'base.bin')) && fs.existsSync(path.join(dir, 'base.json'));

describe.skipIf(!present)('the generated world', () => {
  let info: { w: number; h: number; generatedAt: string };
  let base: Uint8Array;
  let hazards: Uint8Array;
  let elevFd: number;
  /** base byte at a place */
  const at = (lon: number, lat: number): number => {
    const t = lonLatToTile(lon, lat);
    return base[t.y * WORLD_W + t.x];
  };
  const biomeAt = (lon: number, lat: number): Biome => (at(lon, lat) & BASE_BIOME_MASK) as Biome;
  const isLand = (lon: number, lat: number): boolean => !(at(lon, lat) & BASE_WATER);
  /** Elevations of a rectangle of tiles, row-major. */
  const elevRect = (x0: number, y0: number, w: number, h: number): Int16Array => {
    const out = new Int16Array(w * h),
      row = Buffer.alloc(w * 2);
    for (let dy = 0; dy < h; dy++) {
      fs.readSync(elevFd, row, 0, row.length, ((y0 + dy) * WORLD_W + x0) * 2);
      for (let dx = 0; dx < w; dx++) out[dy * w + dx] = row.readInt16LE(dx * 2);
    }
    return out;
  };
  const elevAt = (lon: number, lat: number): number => {
    const t = lonLatToTile(lon, lat);
    return elevRect(t.x, t.y, 1, 1)[0];
  };
  /** Elevations of every tile in a lon/lat box. */
  const elevBox = (w: number, s: number, e: number, n: number): Int16Array => {
    const a = lonLatToTile(w, n),
      b = lonLatToTile(e, s);
    return elevRect(a.x, a.y, b.x - a.x + 1, b.y - a.y + 1);
  };
  const hazardsAt = (lon: number, lat: number): number => {
    const t = lonLatToTile(lon, lat),
      c = chunkOf(t.x, t.y);
    return hazards[c.cy * CHUNKS_X + c.cx];
  };
  /** land tiles per chunk, row-major */
  let land: Int32Array;

  beforeAll(() => {
    info = JSON.parse(fs.readFileSync(path.join(dir, 'base.json'), 'utf8'));
    configureWorld(info.w, info.h);
    base = new Uint8Array(fs.readFileSync(path.join(dir, 'base.bin')));
    hazards = new Uint8Array(fs.readFileSync(path.join(dir, 'hazards.bin')));
    elevFd = fs.openSync(path.join(dir, 'elevation.bin'), 'r');
    land = new Int32Array(CHUNKS_X * CHUNKS_Y);
    const W = WORLD_W,
      shift = Math.log2(CHUNK);
    for (let y = 0; y < WORLD_H; y++) {
      const row = (y >> shift) * CHUNKS_X;
      for (let x = 0; x < W; x++) if (!(base[y * W + x] & BASE_WATER)) land[row + (x >> shift)]++;
    }
  });

  it('has its files in the world format', () => {
    expect(info.w / info.h, 'an equirectangular Earth is twice as wide as it is high').toBe(2);
    expect(typeof info.generatedAt).toBe('string');
    expect(base.length, 'base.bin: a byte per tile').toBe(WORLD_W * WORLD_H);
    expect(fs.statSync(path.join(dir, 'elevation.bin')).size, 'elevation.bin: an Int16 per tile').toBe(WORLD_W * WORLD_H * 2);
    expect(hazards.length, 'hazards.bin: a byte per chunk').toBe(CHUNKS_X * CHUNKS_Y);
  });

  it('has land and water where the Earth has them', () => {
    expect(isLand(-0.13, 51.55), 'London (north of the Thames) is land').toBe(true);
    expect(isLand(2.5, 46.5), 'the middle of France is land').toBe(true);
    expect(isLand(139.7, 35.7), 'Tokyo is land').toBe(true);
    expect(isLand(-30, 0), 'the mid-Atlantic is sea').toBe(false);
    expect(isLand(-150, 0), 'the Pacific is sea').toBe(false);
    // the smoke test used to found its city by London: the plot has room for one
    const l = lonLatToTile(-0.13, 51.55),
      c = chunkOf(l.x, l.y);
    expect(land[c.cy * CHUNKS_X + c.cx], "London's plot has room for a first city").toBeGreaterThanOrEqual(MIN_LAND_TILES_FIRST_CLAIM);
  });

  it('has its biomes in the right places', () => {
    expect(biomeAt(13, 23), 'the Sahara is desert').toBe(Biome.Desert);
    expect(biomeAt(-40, 75), 'Greenland is an ice sheet').toBe(Biome.Snow);
    expect(biomeAt(0, -80), 'Antarctica is an ice sheet').toBe(Biome.Snow);
    expect(biomeAt(2.35, 48.85), 'Paris is temperate').toBe(Biome.Temperate);
    expect([Biome.Boreal, Biome.Tundra], 'Siberia is boreal or tundra').toContain(biomeAt(105, 62));
  });

  it('freezes the Arctic Ocean but not the tropics', () => {
    for (const [lon, lat] of [
      [0, 88],
      [-150, 85],
      [100, 84],
    ])
      expect(baseIsFrozen(at(lon, lat)), `the Arctic Ocean at ${lon},${lat} is frozen`).toBe(true);
    expect(baseIsFrozen(at(-150, 0)), 'the Pacific at the equator is open water').toBe(false);
    expect(baseIsFrozen(at(-30, 45)), 'the North Atlantic is open water').toBe(false);
  });

  it('has the Dutch coast low and coastal', () => {
    // the disasters test used to flood a town at Zandvoort: its plot has land and sea, and low land by the water
    const z = lonLatToTile(4.53, 52.37),
      c = chunkOf(z.x, z.y);
    const n = land[c.cy * CHUNKS_X + c.cx];
    expect(n, 'land on the Dutch coast').toBeGreaterThan(0);
    expect(n, 'and sea').toBeLessThan(CHUNK * CHUNK);
    expect(hazardsAt(4.53, 52.37) & hazardBit(Disaster.Flood), 'floods can strike the Dutch coast').toBeTruthy();
    expect(Math.abs(elevAt(4.9, 52.37)), 'Amsterdam is within a few metres of sea level').toBeLessThanOrEqual(10);
  });

  it('has plausible elevation', () => {
    expect(Math.max(...elevBox(86, 27.5, 88, 28.5)), 'the Himalaya top 6,000 m').toBeGreaterThan(6000);
    expect(elevAt(-150, 0), 'the Pacific is deep').toBeLessThan(-3000);
    expect(elevAt(-30, 30), 'so is the Atlantic').toBeLessThan(-2000);
    const plains = elevAt(-98, 38);
    expect(plains > 200 && plains < 1000, `the Great Plains (${plains} m)`).toBe(true);
    // and the base map agrees with the elevation about where the sea is, mostly
    let agree = 0,
      n = 0;
    for (let lat = -60; lat <= 70; lat += 5)
      for (let lon = -180; lon < 180; lon += 5) {
        const e = elevAt(lon, lat);
        if (Math.abs(e) < 50) continue; // coasts and lowlands: either way
        n++;
        if (e > 0 === isLand(lon, lat)) agree++;
      }
    expect(agree / n, 'land is above sea level and sea below it').toBeGreaterThan(0.97);
  });

  it('has hazard zones where the Earth has them', () => {
    expect(hazardsAt(139.7, 35.7) & hazardBit(Disaster.Earthquake), 'earthquakes in Tokyo').toBeTruthy();
    expect(hazardsAt(-122.4, 37.8) & hazardBit(Disaster.Earthquake), 'earthquakes in San Francisco').toBeTruthy();
    expect(hazardsAt(134, -25) & hazardBit(Disaster.Earthquake), 'no earthquakes in the middle of Australia').toBeFalsy();
    expect(hazardsAt(-97.5, 35.5) & hazardBit(Disaster.Tornado), 'tornadoes in Oklahoma').toBeTruthy();
    expect(hazardsAt(-3.7, 40.4) & hazardBit(Disaster.Tornado), 'no tornadoes in Madrid').toBeFalsy();
    expect(hazardsAt(-80.2, 25.8) & hazardBit(Disaster.Storm), 'tropical storms in Miami').toBeTruthy();
    expect(hazardsAt(-0.1, 51.5) & hazardBit(Disaster.Storm), 'no tropical storms in London').toBeFalsy();
    expect(hazardsAt(105, 62) & hazardBit(Disaster.Blizzard), 'blizzards in Siberia').toBeTruthy();
    let any = 0;
    for (const h of hazards) any |= h;
    for (let d = 0; d < 6; d++) expect(any & hazardBit(d), `somewhere has disaster ${Disaster[d]}`).toBeTruthy();
  });

  it('has plots to found cities on, and coastal strips to buy', () => {
    // (the smoke test's world stats used to count these on the real map)
    expect(land.filter((n) => n >= MIN_LAND_TILES_TO_CLAIM).length, 'plots with enough land to claim').toBeGreaterThanOrEqual(1000);
    // (the first-plot test used to find these: a mostly-water plot next to a plot with plenty of land)
    let pairs = 0;
    for (let cy = 1; cy < CHUNKS_Y - 1 && pairs < 5; cy++)
      for (let cx = 1; cx < CHUNKS_X - 1 && pairs < 5; cx++) {
        const n = land[cy * CHUNKS_X + cx];
        if (n < MIN_LAND_TILES_TO_CLAIM * 4 || n >= MIN_LAND_TILES_FIRST_CLAIM / 2) continue;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ])
          if (land[(cy + dy) * CHUNKS_X + cx + dx] >= MIN_LAND_TILES_FIRST_CLAIM * 2) {
            pairs++;
            break;
          }
      }
    expect(pairs, 'mostly-water plots next to a plot with plenty of land').toBeGreaterThan(0);
  });

  it('has its places loaded, at the right spots', () => {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'places.json'), 'utf8')) as { places: [string, number, number, number, string][] };
    expect(raw.places.length, 'populated places').toBeGreaterThan(5000);
    for (let k = 1; k < raw.places.length; k++) expect(raw.places[k][3] <= raw.places[k - 1][3], 'sorted by population').toBe(true);
    for (const [name, lon, lat] of [
      ['London', -0.1, 51.5],
      ['Paris', 2.35, 48.85],
      ['Tokyo', 139.7, 35.7],
      ['Sydney', 151.2, -33.9],
    ] as const) {
      const p = raw.places.find((q) => q[0] === name);
      expect(p, `${name} is a place`).toBeDefined();
      const t = lonLatToTile(lon, lat);
      expect(Math.hypot(p![1] - t.x, p![2] - t.y), `${name} where it is on the map`).toBeLessThan(64);
    }
  });
});
