// The numbers in the world stats dialog: the whole planet at a glance. Counted over every claimed plot, so it is
// cached for WORLD_STATS_MS and only computed when someone asks.
import {
  CHUNK, CHUNKS_X, CHUNKS_Y, WORLD_W, LOMASK, ZONEBIT, BIOME_COUNT, BASE_WATER, BASE_BIOME_MASK, MIN_LAND_TILES_TO_CLAIM,
  MAP_CLASS_OF_ID, OvClass, DISASTER_COUNT, parseChunkKey, type WorldStats,
  POWERPLANT, NUCLEAR, WINDFARM, OFFSHORE, COAL_POWER, NUCLEAR_POWER, WIND_POWER, OFFSHORE_POWER,
} from '@globalcity/shared';
import type { World } from './world.ts';
import type { Players } from './players.ts';
import type { Sim } from './sim.ts';

const WORLD_STATS_MS = 30_000;
/** what each kind of plant supplies (counted from the plants standing, so frozen cities count too) */
const PLANT_POWER = new Map([[POWERPLANT, COAL_POWER], [NUCLEAR, NUCLEAR_POWER], [WINDFARM, WIND_POWER], [OFFSHORE, OFFSHORE_POWER]]);

export class WorldStatsCounter {
  private cache: { at: number; stats: WorldStats } | null = null;
  /** claimable plots in the world (land never changes, so counted once) */
  private landPlots = -1;
  /** each chunk's commonest land biome, counted once */
  private readonly biomeOf = new Map<number, number>();

  constructor(private readonly world: World, private readonly players: Players, private readonly sim: Sim) {}

  get(online: number): WorldStats {
    const now = Date.now();
    if (this.cache && now - this.cache.at < WORLD_STATS_MS) return { ...this.cache.stats, online };
    const stats = this.compute(online, now);
    this.cache = { at: now, stats };
    return stats;
  }

  private compute(online: number, now: number): WorldStats {
    const w = this.world, t = w.tiles;
    if (this.landPlots < 0) {
      let n = 0;
      for (let cy = 0; cy < CHUNKS_Y; cy++) for (let cx = 0; cx < CHUNKS_X; cx++) if (w.landCount(cx, cy) >= MIN_LAND_TILES_TO_CLAIM) n++;
      this.landPlots = n;
    }
    let population = 0, cities = 0, monuments = 0, abandoned = 0, powerSupply = 0, plants = 0;
    let biggest: WorldStats['biggest'] = null, newest: WorldStats['newest'] = null;
    for (const p of this.players.players.values()) {
      if (!p.chunks.length) continue;
      if (p.monument) { monuments++; continue; }
      cities++;
      population += p.stats.population;
      if (now - p.lastSeen > 30 * 86_400_000) abandoned++;
      const c = parseChunkKey(p.chunks[0]);
      const name = p.cityName || p.name;
      if (!biggest || p.stats.population > biggest.population) biggest = { name, population: p.stats.population, cx: c.cx, cy: c.cy };
      if (!newest || p.createdAt > newest.at) newest = { name, at: p.createdAt, cx: c.cx, cy: c.cy };
    }
    // what stands on the claimed plots
    const biomes = new Array(BIOME_COUNT).fill(0);
    let roads = 0, rail = 0, powerLines = 0, res = 0, com = 0, ind = 0;
    for (const key of this.players.claims.keys()) {
      const { cx, cy } = parseChunkKey(key), ci = cy * CHUNKS_X + cx;
      let b = this.biomeOf.get(ci);
      if (b === undefined) {
        const counts = new Array(16).fill(0);
        for (let y = cy * CHUNK; y < cy * CHUNK + CHUNK; y++) for (let x = cx * CHUNK; x < cx * CHUNK + CHUNK; x++) {
          const v = w.base[y * WORLD_W + x];
          if (!(v & BASE_WATER)) counts[v & BASE_BIOME_MASK]++;
        }
        b = counts.indexOf(Math.max(...counts));
        this.biomeOf.set(ci, b);
      }
      if (b < BIOME_COUNT) biomes[b]++;
      for (let y = cy * CHUNK; y < cy * CHUNK + CHUNK; y++) {
        const row = y * WORLD_W;
        for (let x = cx * CHUNK; x < cx * CHUNK + CHUNK; x++) {
          const v = t[row + x], c = MAP_CLASS_OF_ID[v & LOMASK];
          if (c === OvClass.Road || c === OvClass.Traffic) roads++;
          else if (c === OvClass.Rail) rail++;
          else if (c === OvClass.Wire) powerLines++;
          else if ((v & ZONEBIT) && (v & LOMASK) === OFFSHORE) { plants++; powerSupply += OFFSHORE_POWER; } // drawn as water on the map
          else if (v & ZONEBIT) { if (c === OvClass.Res) res++; else if (c === OvClass.Com) com++; else if (c === OvClass.Ind) ind++; else if (c === OvClass.Power) { plants++; powerSupply += PLANT_POWER.get(v & LOMASK) ?? 0; } }
        }
      }
    }
    const disasters = new Array(DISASTER_COUNT).fill(0);
    for (const e of this.sim.disasters.history(now - 86_400_000)) disasters[e.kind]++;
    return {
      year: this.players.time.year,
      population, cities, monuments, abandoned, online,
      plots: this.players.claims.size, landPlots: this.landPlots,
      biggest, newest,
      roads, rail, powerLines, zones: { res, com, ind }, plants, powerSupply,
      airports: this.sim.airports.length, seaports: this.sim.shipping.ports.length, seaRoutes: this.sim.shipping.routes.length,
      disasters, activeDisasters: this.sim.disasters.active().length,
      biomes,
    };
  }
}
