// Build prediction: run the shared build rules (shared/src/build.ts) on the client's copy of the map the moment
// the player builds, so the change shows at once. The server stays the authority: every build carries a seq,
// the server answers 'built' (after the tiles that carry the real change), and the prediction is dropped then.
import {
  WORLD_W,
  CUSTOM_BUILDINGS,
  MILESTONE_BUILDINGS,
  isMilestoneTool,
  applyBuildRules,
  countCustomIn,
  countMilestoneIn,
  chunkKey,
  describeLook,
  lookOf,
  mathRandInt,
  type BuildBuilding,
  type BuildPlayer,
  type BuildRng,
  type BuildWorld,
  type CustomBuilding,
  type PlayerStats,
  type ToolId,
} from '@globalcity/shared';
import type { TileMap } from './map.ts';

/** A prediction nobody answered for this long is dropped (a lost ack, a server that doesn't send them). */
export const PREDICTION_TIMEOUT_MS = 5000;

/** What the predictor needs of the custom-building layer (custom.ts). */
export interface PredictCustoms {
  at(x: number, y: number): BuildBuilding | undefined;
  predict(seq: number, op: 'add' | 'remove', b: CustomBuilding): void;
  settle(seq?: number): void;
}
/** What the predictor needs to know about me (state.ts). */
export interface PredictState {
  readonly funds: number;
  readonly stats: PlayerStats | null;
  ownsChunk(cx: number, cy: number): boolean;
  myChunks(): readonly { cx: number; cy: number }[];
}

/** Frozen water, read from a water tile's look (the client has no landscape map; the look says it). */
function lookFrozen(v: number): boolean {
  const d = describeLook(lookOf(v));
  return d.kind === 'ice' || (d.kind === 'skin' && d.frozen);
}

/** The map as the build rules see it: writes go to a scratch layer, kept only if the whole build works out. */
class ScratchWorld implements BuildWorld {
  readonly writes = new Map<number, number>();
  readonly added: BuildBuilding[] = [];
  readonly removed: BuildBuilding[] = [];
  /** the rules read a tile the client doesn't have: no prediction */
  missing = false;
  constructor(
    private readonly map: TileMap,
    private readonly customs: PredictCustoms,
  ) {}
  get(x: number, y: number): number {
    const w = this.writes.get(y * WORLD_W + x);
    if (w !== undefined) return w;
    const v = this.map.get(x, y);
    if (v === undefined) {
      this.missing = true;
      return 0;
    }
    return v;
  }
  set(x: number, y: number, v: number): void {
    this.writes.set(y * WORLD_W + x, v);
  }
  frozen(x: number, y: number): boolean {
    return lookFrozen(this.get(x, y));
  }
  readonly buildings = {
    at: (x: number, y: number): BuildBuilding | undefined => {
      for (const b of this.added) if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return b;
      const b = this.customs.at(x, y);
      return b && !this.removed.some((r) => r.x === b.x && r.y === b.y) ? b : undefined;
    },
    add: (kind: string, x: number, y: number): void => {
      const d = CUSTOM_BUILDINGS[kind];
      this.added.push({ kind, x, y, w: d.w, h: d.h });
    },
    remove: (b: BuildBuilding): void => {
      this.removed.push(b);
    },
  };
}

export class Predictor {
  private seq = 0;
  /** builds sent and not yet answered (or timed out), oldest first; cost is 0 when nothing was predicted */
  private readonly pending: { seq: number; at: number; cost: number }[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  /** predictions the server refused (for tests and the console) */
  refused = 0;

  constructor(
    private readonly map: TileMap,
    private readonly customs: PredictCustoms,
    private readonly state: PredictState,
    private readonly now: () => number = () => performance.now(),
    private readonly rng: BuildRng = mathRandInt,
  ) {}

  /** The seq for the next build. */
  next(): number {
    return ++this.seq;
  }

  /**
   * Predict build `seq` (tool at x,y) on the client's map. Returns the predicted cost, or null when the rules
   * say no or the client can't tell (then nothing changes on screen: the server explains).
   */
  predict(seq: number, tool: ToolId, x: number, y: number): number | null {
    const world = new ScratchWorld(this.map, this.customs);
    const r = applyBuildRules(world, this.player(world), tool, x, y, {}, this.rng);
    const ok = r.ok && !world.missing;
    this.pending.push({ seq, at: this.now(), cost: ok ? r.cost : 0 });
    this.startTimer();
    if (!ok) return null;
    for (const b of world.removed) this.customs.predict(seq, 'remove', b);
    for (const b of world.added) this.customs.predict(seq, 'add', b);
    this.map.predict(seq, world.writes);
    return r.cost;
  }

  /** The server's answer for build `seq` (answers come in order): drop every prediction up to it. */
  ack(seq: number, ok: boolean): void {
    const p = this.pending.find((e) => e.seq === seq);
    if (!ok && p && p.cost > 0) {
      this.refused++;
      console.info(`[predict] build ${seq} was refused; showing the server's tiles`);
    }
    this.settle(seq);
  }

  /** Drop all predictions (reconnect: no answers are coming). */
  clear(): void {
    this.settle(Infinity);
  }

  /** Predicted builds still waiting for an answer (tests). */
  get waiting(): number {
    return this.pending.length;
  }

  /** Drop predictions older than PREDICTION_TIMEOUT_MS. */
  expire(): void {
    const cutoff = this.now() - PREDICTION_TIMEOUT_MS;
    let upTo = -1;
    for (const e of this.pending) {
      if (e.at > cutoff) break;
      upTo = e.seq;
    }
    if (upTo >= 0) this.settle(upTo);
  }

  private settle(seq: number): void {
    while (this.pending.length && this.pending[0].seq <= seq) this.pending.shift();
    this.map.settle(seq);
    this.customs.settle(seq);
    if (!this.pending.length && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private startTimer(): void {
    if (!this.timer) this.timer = setInterval(() => this.expire(), 1000);
  }

  /** Me as the build rules see me. Funds leave out what the builds still in flight will cost. */
  private player(world: ScratchWorld): BuildPlayer {
    const { state } = this;
    const inFlight = this.pending.reduce((s, e) => s + e.cost, 0);
    const unlocked = state.stats?.unlocked ?? [];
    const mine = (): string[] => state.myChunks().map((c) => chunkKey(c.cx, c.cy));
    return {
      funds: state.funds - inFlight,
      ownsChunk: (cx, cy) => state.ownsChunk(cx, cy),
      unlocked: () => unlocked,
      // seasonal tools: the server lists those in season (old servers don't: then no prediction)
      inSeason: (tool) => !(isMilestoneTool(tool) && MILESTONE_BUILDINGS[tool].months) || (state.stats?.inSeason ?? []).includes(tool),
      // the server lists Grand Central as unlocked once the rail is linked
      railLinked: unlocked.includes('grandcentral'),
      countMilestone: (b) => countMilestoneIn(world, mine(), b),
      countCustom: (kind) => countCustomIn(world, mine(), kind),
    };
  }
}
