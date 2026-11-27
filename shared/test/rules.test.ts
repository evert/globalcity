// Pure rules from shared/: plot prices and land rules, Santa's route, and the build rules on a small world.
import { describe, it, expect } from 'vitest';
import {
  CHUNK,
  WORLD_W,
  LOMASK,
  DIRT,
  RIVER,
  CLAIM_BASE_COST,
  MAX_CHUNKS_PER_PLAYER,
  MIN_LAND_TILES_FIRST_CLAIM,
  MIN_LAND_TILES_TO_CLAIM,
  SANTA_MIN_TREES,
  CUSTOM_BUILDINGS,
  MILESTONE_BUILDINGS,
  TOOLS,
  claimCost,
  minLandToClaim,
  santaRoute,
  sleighAt,
  applyBuildRules,
  isWater,
  isZoneTile,
  type BuildBuilding,
  type BuildPlayer,
  type BuildWorld,
  type SantaTree,
} from '../src/index.ts';

describe('plots', () => {
  it('the first plot is free, then prices climb in steps of $500', () => {
    expect(claimCost(0)).toBe(0);
    expect(claimCost(-1)).toBe(0);
    expect(claimCost(1)).toBe(CLAIM_BASE_COST);
    for (let n = 1; n < MAX_CHUNKS_PER_PLAYER; n++) {
      expect(claimCost(n) % 500).toBe(0);
      expect(claimCost(n + 1)).toBeGreaterThan(claimCost(n));
    }
  });

  it('a first plot needs much more land than an extra one', () => {
    expect(minLandToClaim(0)).toBe(MIN_LAND_TILES_FIRST_CLAIM);
    expect(minLandToClaim(1)).toBe(MIN_LAND_TILES_TO_CLAIM);
    expect(minLandToClaim(10)).toBe(MIN_LAND_TILES_TO_CLAIM);
    expect(MIN_LAND_TILES_FIRST_CLAIM).toBeGreaterThan(MIN_LAND_TILES_TO_CLAIM);
  });
});

describe('Santa', () => {
  const trees: SantaTree[] = [
    { x: 1000, y: 2000 },
    { x: 9000, y: 2500 },
    { x: 5000, y: 1800 },
    { x: 5000, y: 3000 },
    { x: 300, y: 2200 },
  ];

  it(`only flies with at least ${SANTA_MIN_TREES} trees`, () => {
    for (let n = 0; n < SANTA_MIN_TREES; n++) expect(santaRoute(trees.slice(0, n))).toBeNull();
    expect(santaRoute(trees.slice(0, SANTA_MIN_TREES))).not.toBeNull();
  });

  it('visits every tree, east to west', () => {
    const r = santaRoute(trees)!;
    expect(r.stops).toHaveLength(trees.length);
    for (let i = 1; i < r.stops.length; i++) expect(r.stops[i].x).toBeLessThanOrEqual(r.stops[i - 1].x);
    expect(r.period).toBeGreaterThan(r.trip);
  });

  it('always heads west, and is gone between trips', () => {
    const r = santaRoute(trees)!;
    for (const l of r.legs) expect(l.dx).toBeLessThanOrEqual(0);
    let seen = 0;
    for (let t = 0; t < r.trip; t += 250) {
      const s = sleighAt(r, t)!;
      expect(s, `sleigh at ${t} ms`).not.toBeNull();
      expect(s.vx).toBeLessThanOrEqual(0);
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThan(WORLD_W);
      seen++;
    }
    expect(seen).toBeGreaterThan(10);
    expect(sleighAt(r, r.trip + 1000)).toBeNull();
    expect(sleighAt(r, r.period - 1)).toBeNull();
    expect(sleighAt(r, r.period + 1000)).not.toBeNull(); // the next trip
  });
});

describe('build rules', () => {
  // one owned chunk at (4,4) with a river across rows 40..43
  const CX = 4,
    CY = 4,
    X0 = CX * CHUNK,
    Y0 = CY * CHUNK;
  class World implements BuildWorld {
    readonly tiles = new Map<number, number>();
    readonly reg = new Map<string, BuildBuilding>();
    get(x: number, y: number): number {
      return this.tiles.get(y * WORLD_W + x) ?? (y - Y0 >= 40 && y - Y0 < 44 ? RIVER : DIRT);
    }
    set(x: number, y: number, v: number): void {
      this.tiles.set(y * WORLD_W + x, v & 0xffff);
    }
    frozen(): boolean {
      return false;
    }
    readonly buildings = {
      at: (x: number, y: number) => {
        for (const b of this.reg.values()) if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return b;
        return undefined;
      },
      add: (kind: string, x: number, y: number) => {
        const d = CUSTOM_BUILDINGS[kind];
        this.reg.set(`${x},${y}`, { kind, x, y, w: d.w, h: d.h });
      },
      remove: (b: BuildBuilding) => {
        this.reg.delete(`${b.x},${b.y}`);
      },
    };
  }
  const player = (funds: number, unlocked: string[] = []): BuildPlayer => ({
    funds,
    ownsChunk: (cx, cy) => cx === CX && cy === CY,
    unlocked: () => unlocked,
    inSeason: () => true,
    railLinked: false,
    countMilestone: () => 0,
    countCustom: () => 0,
  });
  const rng = (): number => 0;

  it('only builds on claimed land', () => {
    const r = applyBuildRules(new World(), player(1e6), 'road', X0 + CHUNK, Y0 + 5, {}, rng);
    expect(r).toMatchObject({ ok: false, msg: 'You can only build on land you have claimed' });
    // a zone whose footprint pokes out of the plot
    expect(applyBuildRules(new World(), player(1e6), 'residential', X0, Y0 + 5, {}, rng).ok).toBe(false);
  });

  it('charges the tool cost and refuses without the funds', () => {
    const w = new World();
    expect(applyBuildRules(w, player(1e6), 'residential', X0 + 5, Y0 + 5, {}, rng)).toEqual({ ok: true, cost: TOOLS.residential.cost });
    expect(isZoneTile(w.get(X0 + 5, Y0 + 5))).toBe(true);
    expect(applyBuildRules(w, player(TOOLS.road.cost - 1), 'road', X0 + 20, Y0 + 5, {}, rng)).toMatchObject({ ok: false, msg: 'Not enough funds' });
  });

  it('keeps milestone buildings locked until their population', () => {
    const r = applyBuildRules(new World(), player(1e6), 'university', X0 + 10, Y0 + 10, {}, rng);
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.msg).toMatch(new RegExp(`unlocks at ${MILESTONE_BUILDINGS.university.pop.toLocaleString('en-US')} people`));
    const w = new World();
    expect(applyBuildRules(w, player(1e6, ['university']), 'university', X0 + 10, Y0 + 10, {}, rng).ok).toBe(true);
    expect(w.reg.size).toBe(1);
  });

  it('bridges water, and bulldozing the bridge leaves water', () => {
    const w = new World();
    const y = Y0 + 41;
    expect(applyBuildRules(w, player(1e6), 'bulldozer', X0 + 30, y, {}, rng)).toMatchObject({ ok: false, msg: "Can't bulldoze open water" });
    expect(applyBuildRules(w, player(1e6), 'road', X0 + 30, y, {}, rng).ok).toBe(true);
    expect(w.get(X0 + 30, y) & LOMASK).not.toBe(RIVER);
    expect(applyBuildRules(w, player(1e6), 'bulldozer', X0 + 30, y, {}, rng).ok).toBe(true);
    expect(isWater(w.get(X0 + 30, y))).toBe(true);
  });
});

describe('power units', () => {
  it('shows power as watts: 1 unit is 1 MW', async () => {
    const { fmtPower } = await import('../src/constants.ts');
    expect(fmtPower(0)).toBe('0 MW');
    expect(fmtPower(40)).toBe('40 MW');
    expect(fmtPower(400)).toBe('400 MW');
    expect(fmtPower(1200)).toBe('1.2 GW');
    expect(fmtPower(19_200)).toBe('19.2 GW');
    expect(fmtPower(1_150_000)).toBe('1.15 TW');
  });

  it("shows two amounts with the unit once, the larger one's", async () => {
    const { fmtPowerPair } = await import('../src/constants.ts');
    expect(fmtPowerPair(0, 0)).toBe('0 / 0 MW');
    expect(fmtPowerPair(120, 400)).toBe('120 / 400 MW');
    expect(fmtPowerPair(800, 1200)).toBe('0.8 / 1.2 GW');
    expect(fmtPowerPair(1000, 5000)).toBe('1 / 5 GW');
    expect(fmtPowerPair(19_200, 400)).toBe('19.2 / 0.4 GW');
  });
});
