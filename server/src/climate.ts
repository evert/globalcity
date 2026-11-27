// What drives the climate model (shared/src/climate.ts): the coal plants, industrial zones and residents standing on
// claimed plots (frozen cities included: like the world stats, their plants keep running), and which residents
// live near rail. Counted by a survey that sweeps a slice of the claimed plots every tick, so the work is spread
// evenly over the year instead of one big scan; each year uses the last completed sweep.
import { CHUNK, WORLD_W, LOMASK, ZONEBIT, POWERPLANT, isIndZone, isResZone, parseChunkKey } from '@globalcity/shared';
import type { World } from './world.ts';
import { zonePop } from './zones.ts';

export interface SurveyTotals {
  coal: number;
  industry: number;
  /** people living in residential zones (20 per unit of zone population, as displayPopulation counts them) */
  residents: number;
  /** ...of whom live within reach of rail */
  railResidents: number;
}
const zero = (): SurveyTotals => ({ coal: 0, industry: 0, residents: 0, railResidents: 0 });

/** Count one claimed plot into `t`. `railServed(x, y)`: is the zone centred there served by rail? */
function surveyChunk(world: World, key: string, t: SurveyTotals, railServed: (x: number, y: number) => boolean): void {
  const tiles = world.tiles;
  const { cx, cy } = parseChunkKey(key);
  for (let y = cy * CHUNK; y < cy * CHUNK + CHUNK; y++) {
    const row = y * WORLD_W;
    for (let x = cx * CHUNK; x < cx * CHUNK + CHUNK; x++) {
      const v = tiles[row + x];
      if (!(v & ZONEBIT)) continue;
      if ((v & LOMASK) === POWERPLANT) t.coal++;
      else if (isIndZone(v)) t.industry++;
      else if (isResZone(v)) {
        const people = zonePop(world, x, y, v & LOMASK) * 20;
        t.residents += people;
        if (people && railServed(x, y)) t.railResidents += people;
      }
    }
  }
}

export class ClimateSurvey {
  /** the last completed sweep (null until one finishes) */
  last: SurveyTotals | null = null;
  private keys: string[] = [];
  private cursor = 0;
  private acc = zero();

  /** Survey the next slice of plots, sized so a sweep takes `stepsPerYear` steps. `claims()` is read as a sweep starts. */
  step(world: World, claims: () => Iterable<string>, stepsPerYear: number, railServed: (x: number, y: number) => boolean): void {
    if (this.cursor >= this.keys.length) {
      if (this.keys.length) this.last = this.acc;
      this.keys = [...claims()];
      this.cursor = 0;
      this.acc = zero();
      if (!this.keys.length) {
        this.last = zero();
        return;
      }
    }
    const slice = Math.max(1, Math.ceil(this.keys.length / stepsPerYear));
    for (const end = Math.min(this.keys.length, this.cursor + slice); this.cursor < end; this.cursor++)
      surveyChunk(world, this.keys[this.cursor], this.acc, railServed);
  }

  /** A whole sweep at once (boot, so the stats have numbers straight away). */
  sweep(world: World, claims: Iterable<string>, railServed: (x: number, y: number) => boolean): SurveyTotals {
    const t = zero();
    for (const key of claims) surveyChunk(world, key, t, railServed);
    this.last = t;
    this.keys = [];
    this.cursor = 0;
    this.acc = zero();
    return t;
  }
}
