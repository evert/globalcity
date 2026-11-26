// Natural disasters (shared/src/disasters.ts): which kinds a city can get comes from the world's hazard map; at
// most one strikes every 10 minutes in the whole world (about one every 15 on average), always in a city whose mayor is online, and everyone playing is
// told; a disaster only ever touches the plots of the city it strikes. Damage is Micropolis-style: buildings hit become rubble (or catch fire),
// floods cover low land next to water and then recede, a tornado tears a path across town.
import {
  WORLD_W, WORLD_H, CHUNK, LOMASK, BULLBIT, BURNBIT, RUBBLE, FLOOD, DIRT, WATER_LOW, WATER_HIGH,
  Disaster, DISASTERS, DISASTER_COUNT, DISASTER_MIN_GAP_MS, DISASTER_STEP_P, DISASTER_MIN_POP, hazardBit,
  isWater, isTree, isWire, isRoad, isRail, isOverWater, isOffshoreTile, chunkKey, parseChunkKey, type ActiveDisaster,
} from '@globalcity/shared';
import type { World } from './world.ts';
import type { Players, PlayerRecord } from './players.ts';
import type { Elevation } from './elevation.ts';
import { findZoneCenter, clearFootprint, isBuildingTile } from './zones.ts';

/** DISASTER_EVERY_MS (testing): a disaster exactly this often, instead of the usual gap (DISASTER_MIN_GAP_MS) and the random wait after it */
const EVERY_MS = Number(process.env.DISASTER_EVERY_MS) || 0;
const MIN_GAP_MS = EVERY_MS || DISASTER_MIN_GAP_MS, STEP_P = EVERY_MS ? 1 : DISASTER_STEP_P;

/** Land no higher than this (metres) next to water floods. */
const FLOOD_MAX_ELEV = 10;
const FLOOD_RISE_STEPS = 8, FLOOD_SPREAD_P = 0.35, FLOOD_RECEDE_P = 0.12, FLOOD_STRETCH = 12;
const TORNADO_STEPS = 36, TORNADO_SPEED = 1.6, TORNADO_HIT_P = 0.7;
const QUAKE_SHAKE_MS = 12_000;

const rand = Math.random;
const randInt = (n: number): number => Math.floor(rand() * n);
const rubble = (): number => (RUBBLE + randInt(4)) | BULLBIT;
const floodTile = (): number => (FLOOD + randInt(4)) | BULLBIT;
const isFlood = (v: number): boolean => { const id = v & LOMASK; return id >= FLOOD && id < FLOOD + 4; };

interface Run {
  id: number; kind: Disaster; p: PlayerRecord; x: number; y: number; until: number;
  steps: number;
  /** tornado heading */
  dx?: number; dy?: number;
  /** flood: the water's edge it spreads from, and the tiles it has covered */
  flooded?: Set<number>;
  /** flood rising (spreads) for this many more steps, then recedes */
  rise?: number;
  /** blizzard / storm: hits left to make */
  hits?: number;
}

export interface DisasterHooks {
  ignite(x: number, y: number): boolean;
  isFrozen(id: string): boolean;
}

/** `playerId` '*': for everyone else playing (the stricken city's mayor gets their own message). */
export interface DisasterToast { playerId: string; kind: 'error' | 'info'; msg: string; at: { x: number; y: number }; except?: string; big: true }

export class Disasters {
  private runs: Run[] = [];
  /** when the last disaster struck anywhere (ms epoch): at most one per DISASTER_MIN_GAP_MS in the whole world */
  private lastStrike = 0;
  /** announcements not yet delivered (the simulation hands them on every step; the dev hook straight away) */
  private toasts: DisasterToast[] = [];
  private nextId = 1;
  /** bumps when the active list changes (the network layer re-publishes) */
  version = 0;

  constructor(
    private readonly world: World,
    private readonly players: Players,
    private readonly hazards: Uint8Array,
    private readonly elevation: Elevation,
    private readonly hooks: DisasterHooks,
  ) {
    // survive restarts: the last strike is the latest one any city remembers
    for (const p of players.players.values()) this.lastStrike = Math.max(this.lastStrike, p.lastDisaster ?? 0);
  }

  /** Disasters started since `since` (ms epoch), for the world stats; a day of them is kept. */
  history(since: number): { kind: Disaster; at: number }[] { return this.past.filter((e) => e.at >= since); }
  private past: { kind: Disaster; at: number }[] = [];

  /** Take the announcements made since the last call. */
  takeToasts(): DisasterToast[] { const t = this.toasts; this.toasts = []; return t; }

  /** Disasters possible somewhere in a city (HAZARD bits over its plots). */
  hazardsOf(p: PlayerRecord): number {
    let h = 0;
    for (const key of p.chunks) { const { cx, cy } = parseChunkKey(key); h |= this.hazards[cy * (WORLD_W / CHUNK) + cx] ?? 0; }
    return h;
  }

  /** The disasters on the go, for clients. */
  active(): ActiveDisaster[] {
    return this.runs.map((r) => ({ id: r.id, kind: r.kind, x: r.x, y: r.y, ownerId: r.p.id, city: r.p.cityName || r.p.name, until: r.until }));
  }

  /**
   * One simulation step: move the disasters on the go, and maybe start one in a city whose mayor is online.
   * `online` are the cities whose mayor is playing right now (and not frozen).
   */
  step(online: PlayerRecord[], now: number, random: boolean): void {
    const before = this.runs.length;
    for (const r of this.runs) this.advance(r, now);
    const moved = this.runs.some((r) => r.kind === Disaster.Tornado);
    this.runs = this.runs.filter((r) => !this.done(r, now));
    // at most one disaster per gap in the whole world: once the gap is up, now and then one strikes a city
    // that can be struck (its mayor online, big enough, a hazard on its land), picked at random
    if (random && now - this.lastStrike >= MIN_GAP_MS && rand() < STEP_P) {
      const candidates: { p: PlayerRecord; kinds: Disaster[] }[] = [];
      for (const p of online) {
        if (p.stats.population < DISASTER_MIN_POP || p.monument) continue;
        const h = this.hazardsOf(p);
        const kinds: Disaster[] = [];
        for (let d = 0; d < DISASTER_COUNT; d++) if (h & hazardBit(d)) kinds.push(d);
        if (kinds.length) candidates.push({ p, kinds });
      }
      if (candidates.length) {
        const c = candidates[randInt(candidates.length)];
        this.start(c.p, c.kinds[randInt(c.kinds.length)], now);
      }
    }
    if (moved || this.runs.length !== before) this.version++;
  }

  /** Start a disaster in city p now (dev hook and tests use this directly). Returns false if nothing to hit. */
  start(p: PlayerRecord, kind: Disaster, now: number): boolean {
    const tiles = this.cityTiles(p);
    if (!tiles.length) return false;
    const info = DISASTERS[kind];
    const city = p.cityName || 'your city';
    const run: Run = { id: this.nextId++, kind, p, x: 0, y: 0, until: now + 60_000, steps: 0 };
    const pick = (pred: (v: number, i: number) => boolean): number | null => {
      const pool = tiles.filter((i) => pred(this.world.tiles[i], i));
      return pool.length ? pool[randInt(pool.length)] : null;
    };
    const built = (v: number) => (v & BULLBIT) !== 0 && !isWater(v) && !isTree(v);
    let at: number | null = null;
    switch (kind) {
      case Disaster.Earthquake: {
        at = pick(built);
        if (at === null) return false;
        this.quake(p, at % WORLD_W, Math.floor(at / WORLD_W));
        run.until = now + QUAKE_SHAKE_MS;
        break;
      }
      case Disaster.Flood:
      case Disaster.Storm: {
        // floods rise from the water's edge onto low land
        // floods rise along one stretch of shore (about 25 tiles), not the whole waterline at once
        const shore = tiles.filter((i) => isWater(this.world.tiles[i]) && this.landBeside(i, p));
        if (kind === Disaster.Flood && !shore.length) return false;
        const e0 = shore.length ? shore[randInt(shore.length)] : 0, ex = e0 % WORLD_W, ey = Math.floor(e0 / WORLD_W);
        const edge = shore.filter((i) => Math.max(Math.abs((i % WORLD_W) - ex), Math.abs(Math.floor(i / WORLD_W) - ey)) <= FLOOD_STRETCH);
        run.flooded = new Set();
        run.rise = kind === Disaster.Flood ? FLOOD_RISE_STEPS : 5;
        for (const i of edge) run.flooded.add(i); // spreads from here (water tiles are never changed)
        if (kind === Disaster.Storm) run.hits = 12 + Math.min(60, Math.floor(tiles.length / 400));
        at = edge.length ? e0 : pick(built);
        if (at === null) return false;
        run.until = now + 10 * 60_000;
        break;
      }
      case Disaster.Tornado: {
        // touches down at the edge of town and crosses it
        const b = this.bounds(p);
        const side = randInt(4);
        const x = side === 0 ? b.x0 : side === 1 ? b.x1 : b.x0 + randInt(b.x1 - b.x0 + 1);
        const y = side === 2 ? b.y0 : side === 3 ? b.y1 : b.y0 + randInt(b.y1 - b.y0 + 1);
        const tx = (b.x0 + b.x1) / 2 + (rand() - 0.5) * (b.x1 - b.x0) * 0.6, ty = (b.y0 + b.y1) / 2 + (rand() - 0.5) * (b.y1 - b.y0) * 0.6;
        const len = Math.hypot(tx - x, ty - y) || 1;
        run.x = x; run.y = y; run.dx = ((tx - x) / len) * TORNADO_SPEED; run.dy = ((ty - y) / len) * TORNADO_SPEED;
        run.until = now + 5 * 60_000;
        at = y * WORLD_W + x;
        break;
      }
      case Disaster.Wildfire: {
        // several fires start in the woods (or anything that burns) and spread
        let lit = 0;
        for (let k = 0; k < 40 && lit < 5; k++) {
          const i = pick((v) => isTree(v)) ?? pick((v) => (v & BURNBIT) !== 0);
          if (i === null) break;
          if (this.hooks.ignite(i % WORLD_W, Math.floor(i / WORLD_W))) { lit++; at ??= i; }
        }
        if (!lit || at === null) return false;
        run.until = now + 30_000;
        break;
      }
      case Disaster.Blizzard: {
        // snow and ice bring power lines down over the next minute
        at = pick(built);
        if (at === null) return false;
        run.hits = 15 + Math.min(45, Math.floor(tiles.length / 600));
        run.until = now + 2 * 60_000;
        break;
      }
    }
    run.x ||= at % WORLD_W; run.y ||= Math.floor(at / WORLD_W);
    p.lastDisaster = now;
    this.lastStrike = now;
    this.past = this.past.filter((e) => now - e.at < 86_400_000);
    this.past.push({ kind, at: now });
    this.players.dirty = true;
    this.runs.push(run);
    this.version++;
    const where = { x: run.x, y: run.y };
    this.toasts.push({ playerId: p.id, kind: 'error', msg: `${info.emoji} ${info.verb} ${city}!`, at: where, big: true });
    // the news for everyone else playing (click to fly there and watch)
    this.toasts.push({ playerId: '*', except: p.id, kind: 'info', msg: `${info.emoji} ${info.verb} ${p.cityName || `${p.name}'s city`}.`, at: where, big: true });
    return true;
  }

  private done(r: Run, now: number): boolean {
    switch (r.kind) {
      case Disaster.Flood: case Disaster.Storm: return (r.rise ?? 0) <= 0 && (r.hits ?? 0) <= 0 && !this.anyFlood(r);
      case Disaster.Tornado: return r.steps >= TORNADO_STEPS || !this.inCity(r.p, Math.round(r.x), Math.round(r.y)) && r.steps > 3;
      case Disaster.Blizzard: return now >= r.until; // snows for its whole time, bringing lines down while there are any
      default: return now >= r.until;
    }
  }

  private advance(r: Run, now: number): void {
    r.steps++;
    if (r.kind === Disaster.Tornado) {
      // wander a little, smash what's under the funnel
      const a = (rand() - 0.5) * 0.5, c = Math.cos(a), s = Math.sin(a);
      [r.dx, r.dy] = [r.dx! * c - r.dy! * s, r.dx! * s + r.dy! * c];
      r.x += r.dx!; r.y += r.dy!;
      const x = Math.round(r.x), y = Math.round(r.y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (rand() < TORNADO_HIT_P) this.smash(r.p, x + dx, y + dy);
      return;
    }
    if (r.kind === Disaster.Flood || r.kind === Disaster.Storm) {
      if (r.kind === Disaster.Storm && (r.hits ?? 0) > 0) {
        // wind: a few things torn apart every step, mostly near the coast
        for (let k = 0; k < 4 && r.hits! > 0; k++, r.hits!--) {
          const x = r.x + randInt(41) - 20, y = r.y + randInt(41) - 20;
          this.smash(r.p, x, y);
        }
      }
      if ((r.rise ?? 0) > 0) { r.rise!--; this.spreadFlood(r); }
      else this.recede(r);
      return;
    }
    if (r.kind === Disaster.Blizzard && (r.hits ?? 0) > 0) {
      // power lines (and sometimes rail) come down
      const tiles = this.cityTiles(r.p).filter((i) => { const v = this.world.tiles[i]; return isWire(v) && !isOverWater(v); });
      for (let k = 0; k < 3 && r.hits! > 0; k++, r.hits!--) {
        if (!tiles.length) { r.hits = 0; break; }
        const i = tiles.splice(randInt(tiles.length), 1)[0];
        this.world.set(i % WORLD_W, Math.floor(i / WORLD_W), rubble());
      }
    }
    void now;
  }

  /** An earthquake: rubble and fires among what stands around the epicentre (bare ground and water just shake). */
  private quake(p: PlayerRecord, x0: number, y0: number): void {
    const r = 10 + randInt(8), w = this.world;
    const standing: number[] = [];
    for (let y = y0 - r; y <= y0 + r; y++) for (let x = x0 - r; x <= x0 + r; x++) {
      if ((x - x0) ** 2 + (y - y0) ** 2 > r * r || !this.inCity(p, x, y)) continue;
      const v = w.get(x, y);
      if ((v & BULLBIT) && !isWater(v) && !isOverWater(v) && (v & LOMASK) !== DIRT && !((v & LOMASK) >= RUBBLE && (v & LOMASK) < RUBBLE + 4)) standing.push(y * WORLD_W + x);
    }
    const hits = Math.min(standing.length, 30 + Math.min(120, Math.floor(this.cityTiles(p).length / 150)));
    for (let k = 0; k < hits; k++) {
      const i = standing.splice(randInt(standing.length), 1)[0], x = i % WORLD_W, y = (i - x) / WORLD_W;
      if (rand() < 0.15) this.hooks.ignite(x, y); else this.smash(p, x, y);
    }
  }

  /** Destroy what stands on (x, y) if it belongs to city p: a building's whole footprint, or the tile. */
  private smash(p: PlayerRecord, x: number, y: number): void {
    if (!this.inCity(p, x, y)) return;
    const w = this.world, v = w.get(x, y);
    if (!(v & BULLBIT) || isWater(v) || isOverWater(v) || isOffshoreTile(v) || (v & LOMASK) === DIRT) return;
    if ((v & LOMASK) >= RUBBLE && (v & LOMASK) < RUBBLE + 4) return;
    if (isBuildingTile(v)) {
      const z = findZoneCenter(w, x, y);
      if (z && this.inCity(p, z.cx, z.cy)) { clearFootprint(w, z, () => rubble()); return; }
    }
    if (isTree(v) || isRoad(v) || isRail(v) || isWire(v) || (v & BURNBIT)) w.set(x, y, rubble());
  }

  private spreadFlood(r: Run): void {
    const w = this.world, next: number[] = [];
    for (const i of r.flooded!) {
      const x = i % WORLD_W, y = (i - x) / WORLD_W;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= WORLD_W || yy >= WORLD_H || !this.inCity(r.p, xx, yy)) continue;
        const j = yy * WORLD_W + xx;
        if (r.flooded!.has(j) || rand() >= FLOOD_SPREAD_P) continue;
        const v = w.tiles[j], id = v & LOMASK;
        if (id >= WATER_LOW && id <= WATER_HIGH) continue;
        if (!(v & BULLBIT) && id !== DIRT) continue; // what can't be bulldozed can't be flooded either
        if (this.elevation.at(xx, yy) > FLOOD_MAX_ELEV) continue; // the water stays below the high ground
        if (isBuildingTile(v)) { const z = findZoneCenter(w, xx, yy); if (z && this.inCity(r.p, z.cx, z.cy)) clearFootprint(w, z, () => rubble()); }
        w.set(xx, yy, floodTile());
        next.push(j);
      }
    }
    for (const j of next) r.flooded!.add(j);
  }

  private recede(r: Run): void {
    for (const i of [...r.flooded!]) {
      const v = this.world.tiles[i];
      if (isWater(v)) { r.flooded!.delete(i); continue; } // the edge it rose from
      if (!isFlood(v)) { r.flooded!.delete(i); continue; } // bulldozed or rebuilt meanwhile
      if (rand() < FLOOD_RECEDE_P) { this.world.set(i % WORLD_W, Math.floor(i / WORLD_W), DIRT); r.flooded!.delete(i); }
    }
  }

  private anyFlood(r: Run): boolean {
    for (const i of r.flooded ?? []) if (isFlood(this.world.tiles[i])) return true;
    return false;
  }

  private landBeside(i: number, p: PlayerRecord): boolean {
    const x = i % WORLD_W, y = (i - x) / WORLD_W;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy;
      if (!this.inCity(p, xx, yy)) continue;
      if (!isWater(this.world.get(xx, yy)) && this.elevation.at(xx, yy) <= FLOOD_MAX_ELEV) return true;
    }
    return false;
  }

  private inCity(p: PlayerRecord, x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H) return false;
    return this.players.claims.get(chunkKey(Math.floor(x / CHUNK), Math.floor(y / CHUNK))) === p.id;
  }

  private cityTiles(p: PlayerRecord): number[] {
    const out: number[] = [];
    for (const key of p.chunks) {
      const { cx, cy } = parseChunkKey(key);
      for (let y = cy * CHUNK; y < cy * CHUNK + CHUNK; y++) for (let x = cx * CHUNK; x < cx * CHUNK + CHUNK; x++) out.push(y * WORLD_W + x);
    }
    return out;
  }

  private bounds(p: PlayerRecord): { x0: number; y0: number; x1: number; y1: number } {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const key of p.chunks) {
      const { cx, cy } = parseChunkKey(key);
      x0 = Math.min(x0, cx * CHUNK); y0 = Math.min(y0, cy * CHUNK);
      x1 = Math.max(x1, cx * CHUNK + CHUNK - 1); y1 = Math.max(y1, cy * CHUNK + CHUNK - 1);
    }
    return { x0, y0, x1, y1 };
  }
}
