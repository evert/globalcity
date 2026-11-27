// Social features: city names, presence, neighbour + rail-link demand, plot cap, abandonment. The abandonment phase
// fast-forwards D's idle clock with the devIdle hook instead of waiting out the days.
import { describe, it, expect, beforeAll } from 'vitest';
import {
  CHUNK,
  MAX_CHUNKS_PER_PLAYER,
  ABANDON_IDLE_DAYS,
  ABANDON_FREE_DAYS,
  CHUNKS_X,
  CHUNKS_Y,
  WORLD_H,
  chunkKey,
  isWater,
  isRubble,
  isRoad,
  isZoneTile,
  isHouse,
  type ClaimInfo,
} from '@globalcity/shared';
import { TestClient, resetServer, sleep, waitFor, ticks } from './support/client.ts';
import { site as siteNamed, type SiteName } from './support/fixture.ts';

/** Sites with lots of land around, for the 15-plot city and the abandoned town. */
const INTERIOR: SiteName[] = ['inland', 'east'];

// Layout for A (chunk cx,cy; its last 6 columns) and B (chunk cx+1,cy; its first 8 columns), rows Y..:
//   A: coal plant cols AX..AX+3 rows Y..Y+3; wires AX+4, AX+5 row Y+1; res zone AX..AX+2 rows Y+4..Y+6;
//      road row Y+7 cols AX..AX+5; rail row Y+5 cols AX+3..AX+5
//   B: wires BX, BX+1 row Y+1; res zone BX+2..BX+4 rows Y..Y+2; road row Y+3 cols BX+3..BX+6;
//      rail row Y+5 cols BX..BX+2 then north BX+2 rows Y+4, Y+3 (touching the zone's bottom row Y+2)
const A_COLS = 6,
  A_ROWS = 8,
  B_COLS = 8,
  B_ROWS = 6;

function findRow(aTiles: Uint32Array, bTiles: Uint32Array): number | null {
  rows: for (let y = 1; y + A_ROWS < CHUNK - 1; y++) {
    for (let dy = 0; dy < A_ROWS; dy++)
      for (let dx = 0; dx < A_COLS; dx++) {
        if (isWater(aTiles[(y + dy) * CHUNK + CHUNK - A_COLS + dx])) continue rows;
      }
    for (let dy = 0; dy < B_ROWS; dy++)
      for (let dx = 0; dx < B_COLS; dx++) {
        if (isWater(bTiles[(y + dy) * CHUNK + dx])) continue rows;
      }
    return y;
  }
  return null;
}

/** Top-left of a w x h all-land rectangle inside a chunk (local coords), or null. */
function findRect(tiles: Uint32Array, w: number, h: number): { x: number; y: number } | null {
  for (let oy = 1; oy + h < CHUNK - 1; oy++) {
    cols: for (let ox = 1; ox + w < CHUNK - 1; ox++) {
      for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) if (isWater(tiles[(oy + dy) * CHUNK + ox + dx])) continue cols;
      return { x: ox, y: oy };
    }
  }
  return null;
}

const builtTile = (v: number): boolean => isZoneTile(v) || isHouse(v) || isRoad(v);

describe('social', () => {
  let A: TestClient, B: TestClient;
  // D's town, abandoned
  let dSite: { cx: number; cy: number; X: number; Y: number };
  let dKey: string, dBuilt: number, dId: string;
  // A and B side by side
  let cx: number, cy: number, Y: number, AX: number, BX: number;
  let aClaim: ClaimInfo;

  beforeAll(async () => {
    await resetServer();
    A = await TestClient.connect('Alice');
    B = await TestClient.connect('Bob');
  });

  it('has no city name before the first claim', () => {
    expect(A.cityName).toBe('');
    expect(B.cityName).toBe('');
  });

  it('D founds a town, builds and leaves', async () => {
    const D = await TestClient.connect('Dora');
    let site: typeof dSite | null = null;
    for (const name of INTERIOR) {
      const c = siteNamed(name);
      const f = await D.findFree(c.cx, c.cy);
      if (!f) continue;
      await D.subscribe([[f.cx, f.cy]]);
      const r = findRect(D.chunk(f.cx, f.cy), 20, 5);
      if (!r) continue;
      site = { cx: f.cx, cy: f.cy, X: f.cx * CHUNK + r.x, Y: f.cy * CHUNK + r.y };
      break;
    }
    expect(site, 'a free chunk with a 20x5 land rectangle for D').not.toBeNull();
    dSite = site!;
    expect(await D.tryClaim(dSite.cx, dSite.cy), 'D claims').toBe(true);
    dKey = chunkKey(dSite.cx, dSite.cy);
    for (let k = 0; k < 6; k++) D.send({ t: 'build', tool: 'residential', x: dSite.X + 1 + k * 3, y: dSite.Y + 1 });
    for (let dx = 0; dx < 20; dx++) D.send({ t: 'build', tool: 'road', x: dSite.X + dx, y: dSite.Y + 4 });
    await sleep(600);
    expect(D.hasToast(/^error/), `D error toasts: ${D.toastText()}`).toBe(false);
    await A.subscribe([[dSite.cx, dSite.cy]]);
    dBuilt = 0;
    for (let dy = 0; dy < 5; dy++) for (let dx = 0; dx < 20; dx++) if (builtTile(A.tile(dSite.X + dx, dSite.Y + dy)!)) dBuilt++;
    expect(dBuilt, 'tiles D built, as A sees them').toBeGreaterThanOrEqual(70);
    dId = D.id;
    await D.close();
  });

  it('names cities after places, uniquely, and lets mayors rename them', async () => {
    let site: { cx: number; cy: number; Y: number } | null = null;
    for (const c of [siteNamed('inland'), siteNamed('east')]) {
      const a = await A.findFree(c.cx, c.cy);
      if (!a || a.cx + 1 >= CHUNKS_X) continue;
      const b = await B.findFree(a.cx + 1, a.cy);
      if (!b || b.cx !== a.cx + 1 || b.cy !== a.cy) continue;
      await B.subscribe([
        [a.cx, a.cy],
        [b.cx, b.cy],
      ]);
      const y = findRow(B.chunk(a.cx, a.cy), B.chunk(b.cx, b.cy));
      if (y === null) continue;
      site = { cx: a.cx, cy: a.cy, Y: a.cy * CHUNK + y };
      break;
    }
    expect(site, 'a pair of adjacent free chunks with enough land').not.toBeNull();
    ({ cx, cy, Y } = site!);
    AX = (cx + 1) * CHUNK - A_COLS;
    BX = (cx + 1) * CHUNK;
    expect(await A.tryClaim(cx, cy), 'A claims').toBe(true);
    expect(await B.tryClaim(cx + 1, cy), 'B claims').toBe(true);
    await A.subscribe([
      [cx, cy],
      [cx + 1, cy],
      [dSite.cx, dSite.cy],
    ]);
    aClaim = A.claims.get(chunkKey(cx, cy))!;
    const bClaim = B.claims.get(chunkKey(cx + 1, cy))!;
    expect(aClaim.cityName, 'cityName in the claim broadcast').toBeTruthy();
    expect(bClaim.cityName, 'cityName in the claim broadcast').toBeTruthy();
    expect(aClaim.cityName, 'both cities got the same name').not.toBe(bClaim.cityName);
    expect(aClaim.idleDays, 'idleDays for an online owner').toBe(0);
    // B's own view of A's claim carries the same name (claims are global)
    expect(B.claims.get(chunkKey(cx, cy))?.cityName).toBe(aClaim.cityName);
    // rename to a taken name: error; to a free name: success and a claims broadcast
    let n = B.toasts.length;
    B.send({ t: 'renameCity', name: aClaim.cityName.toUpperCase() });
    await B.toastAfter(n, /^error: There is already a city called/);
    const newName = `Bobville ${Math.floor(Math.random() * 1e6)}`;
    n = B.toasts.length;
    B.send({ t: 'renameCity', name: `  ${newName}  ` });
    await B.toastAfter(n, new RegExp(`^success: Your city is now called ${newName}`));
    await waitFor(() => A.claims.get(chunkKey(cx + 1, cy))?.cityName === newName, 'A sees the renamed city');
    expect(B.claims.get(chunkKey(cx + 1, cy))?.cityName, 'B sees its own rename').toBe(newName);
    n = B.toasts.length;
    B.send({ t: 'renameCity', name: '   ' });
    await B.toastAfter(n, /^error: Invalid city name/);
    // a query on A's chunk reports the owner with cityName
    const q = await A.query(AX, Y);
    expect(q.owner?.cityName).toBe(aClaim.cityName);
  });

  it('shows each mayor where the others are looking', async () => {
    const vx = AX + 2.5,
      vy = Y + 3.25;
    const sentAt = Date.now();
    A.send({ t: 'view', x: vx, y: vy, zoom: 2, cx: AX, cy: Y });
    const frame = await waitFor(() => B.presence.find((f) => f.players.some((p) => p.id === A.id)), 'presence frame with A at B', 1500);
    const pa = frame.players.find((p) => p.id === A.id)!;
    expect(Math.abs(pa.x - vx), 'presence x').toBeLessThanOrEqual(0.11);
    expect(Math.abs(pa.y - vy), 'presence y').toBeLessThanOrEqual(0.11);
    expect([pa.cx, pa.cy], 'presence cursor').toEqual([AX, Y]);
    expect(pa.cityName).toBe(aClaim.cityName);
    expect(pa.name).toBe('Alice');
    expect(frame.at - sentAt, 'presence within 1 s').toBeLessThanOrEqual(1000);
    await sleep(600);
    expect(
      A.presence.some((f) => f.players.some((p) => p.id === A.id)),
      "A's own entry in A's presence frames",
    ).toBe(false);
    // out-of-world values are clamped, not dropped
    B.send({ t: 'view', x: -500, y: 1e9, zoom: 1 });
    const fb = await waitFor(() => A.presence.find((f) => f.players.some((p) => p.id === B.id)), 'presence frame with B at A', 1500);
    const pb = fb.players.find((p) => p.id === B.id)!;
    expect(pb.x).toBe(0);
    expect(pb.y).toBe(WORLD_H - 1);
    expect(pb.cx).toBeUndefined();
  });

  it('links neighbours by rail and gives them demand', { timeout: 120_000 }, async () => {
    const toastsBefore = new Map([A, B].map((c) => [c, c.toasts.length]));
    A.send({ t: 'build', tool: 'coal', x: AX + 1, y: Y + 1 });
    A.send({ t: 'build', tool: 'wire', x: AX + 4, y: Y + 1 });
    A.send({ t: 'build', tool: 'wire', x: AX + 5, y: Y + 1 });
    A.send({ t: 'build', tool: 'residential', x: AX + 1, y: Y + 5 });
    for (let dx = 0; dx < A_COLS; dx++) A.send({ t: 'build', tool: 'road', x: AX + dx, y: Y + 7 });
    for (let dx = 3; dx < A_COLS; dx++) A.send({ t: 'build', tool: 'rail', x: AX + dx, y: Y + 5 });
    B.send({ t: 'build', tool: 'wire', x: BX, y: Y + 1 });
    B.send({ t: 'build', tool: 'wire', x: BX + 1, y: Y + 1 });
    B.send({ t: 'build', tool: 'residential', x: BX + 3, y: Y + 1 });
    for (let dx = 3; dx <= 6; dx++) B.send({ t: 'build', tool: 'road', x: BX + dx, y: Y + 3 });
    for (let dx = 0; dx <= 2; dx++) B.send({ t: 'build', tool: 'rail', x: BX + dx, y: Y + 5 });
    B.send({ t: 'build', tool: 'rail', x: BX + 2, y: Y + 4 });
    B.send({ t: 'build', tool: 'rail', x: BX + 2, y: Y + 3 });
    await sleep(500);
    for (const c of [A, B]) expect(c.hasToast(/^error/, toastsBefore.get(c)), `${c.name} error toasts: ${c.toastText(toastsBefore.get(c))}`).toBe(false);
    await waitFor(
      () => A.stats?.railLinks === 1 && B.stats?.railLinks === 1 && A.stats.railDemand > 0 && B.stats.railDemand > 0,
      'railLinks === 1 and railDemand > 0 on both',
      ticks(10),
    );
    // the first rail link unlocks Grand Central for good, with a toast naming the other city
    await waitFor(() => A.stats?.unlocked?.includes('grandcentral') && B.stats?.unlocked?.includes('grandcentral'), 'Grand Central unlocked on both', ticks(3));
    expect(
      A.toasts.some((t) => /You can now build Grand Central/.test(t.msg)),
      'Grand Central unlock toast for A',
    ).toBe(true);
    expect(A.stats!.neighbours).toBeGreaterThanOrEqual(1);
    expect(B.stats!.neighbours).toBeGreaterThanOrEqual(1);
    const rq = await A.query(AX + 4, Y + 5);
    expect(rq.name.startsWith('Rail (links 2 cities)'), `rail query name "${rq.name}"`).toBe(true);
    // neighbour demand needs people next door
    await waitFor(() => (A.stats?.resPop ?? 0) > 0 && (B.stats?.resPop ?? 0) > 0, 'both resPop > 0', ticks(40));
    await waitFor(() => (A.stats?.neighbourDemand.c ?? 0) > 0 && (B.stats?.neighbourDemand.c ?? 0) > 0, 'neighbourDemand.c > 0 on both', ticks(3));
  });

  it(`caps a city at ${MAX_CHUNKS_PER_PLAYER} plots`, async () => {
    const C = await TestClient.connect('Carl');
    C.sendRaw({ t: 'devFunds', amount: 90_000_000 }); // 15 plots cost ~$84M with the escalating price
    await waitFor(() => (C.stats?.funds ?? 0) >= 90_000_000, 'devFunds applied');
    let start: { cx: number; cy: number } | null = null;
    for (const name of [...INTERIOR].reverse()) {
      const c = siteNamed(name);
      start = await C.findFree(c.cx, c.cy);
      if (start && chunkKey(start.cx, start.cy) !== dKey) break;
      start = null;
    }
    expect(start, 'a free chunk for C').not.toBeNull();
    expect(await C.tryClaim(start!.cx, start!.cy), 'C first claim').toBe(true);
    const owned = [start!];
    const tried = new Set<string>([chunkKey(start!.cx, start!.cy)]);
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    outer: for (let k = 0; k < owned.length && owned.length < MAX_CHUNKS_PER_PLAYER; k++) {
      for (const [dx, dy] of dirs) {
        const nx = owned[k].cx + dx,
          ny = owned[k].cy + dy;
        const key = chunkKey(nx, ny);
        if (tried.has(key) || nx < 0 || ny < 0 || nx >= CHUNKS_X || ny >= CHUNKS_Y || key === dKey) continue;
        tried.add(key);
        if (await C.tryClaim(nx, ny)) {
          owned.push({ cx: nx, cy: ny });
          if (owned.length >= MAX_CHUNKS_PER_PLAYER) break outer;
        }
      }
    }
    expect(owned.length, 'plots C could claim').toBe(MAX_CHUNKS_PER_PLAYER);
    expect(C.stats!.chunks).toBe(MAX_CHUNKS_PER_PLAYER);
    let next: { cx: number; cy: number } | null = null;
    for (const o of owned) {
      for (const [dx, dy] of dirs) {
        const key = chunkKey(o.cx + dx, o.cy + dy);
        if (!tried.has(key) && key !== dKey && o.cx + dx >= 0 && o.cy + dy >= 0 && o.cx + dx < CHUNKS_X && o.cy + dy < CHUNKS_Y) {
          next = { cx: o.cx + dx, cy: o.cy + dy };
          break;
        }
      }
      if (next) break;
    }
    expect(next, 'a candidate for one plot too many').not.toBeNull();
    const n = C.toasts.length;
    expect(await C.tryClaim(next!.cx, next!.cy), 'one plot too many is refused').toBe(false);
    await C.toastAfter(n, new RegExp(`^error: Your city is at the maximum of ${MAX_CHUNKS_PER_PLAYER} plots`));
  });

  it('shows an idle town as abandoned, then releases it as it stands to the next mayor', async () => {
    // Nothing decays: whoever claims the released plot gets D's zones and roads as they stand, for the plot price.
    const builtInD = (): number => {
      let n = 0;
      for (let dy = 0; dy < 5; dy++) for (let dx = 0; dx < 20; dx++) if (builtTile(A.tile(dSite.X + dx, dSite.Y + dy)!)) n++;
      return n;
    };
    const rubbleInD = (): number => {
      let r = 0;
      for (let dy = 0; dy < 5; dy++) for (let dx = 0; dx < 20; dx++) if (isRubble(A.tile(dSite.X + dx, dSite.Y + dy)!)) r++;
      return r;
    };
    const intact = (when: string): void => {
      expect(rubbleInD(), `rubble tiles in D ${when}`).toBe(0);
      expect(builtInD(), `built tiles in D ${when}`).toBe(dBuilt);
    };
    const idleNow = (): number => A.claims.get(dKey)?.idleDays ?? -1;
    const idleFor = (days: number): void => A.sendRaw({ t: 'devIdle', id: dId, days });
    idleFor(1);
    await waitFor(() => idleNow() >= 1, 'idleDays for D advance in the claims broadcasts', ticks(4));
    intact('before it was abandoned');
    idleFor(ABANDON_IDLE_DAYS);
    await waitFor(() => idleNow() >= ABANDON_IDLE_DAYS, 'D shown as abandoned', ticks(4));
    intact('once abandoned');
    expect(A.unclaims.includes(dKey), 'not released before ABANDON_FREE_DAYS').toBe(false);
    idleFor(ABANDON_FREE_DAYS);
    await waitFor(() => A.unclaims.includes(dKey), `unclaim of D's chunk`, ticks(4));
    expect(A.claims.has(dKey), "D's claim listed after unclaim").toBe(false);
    await sleep(ticks(10));
    intact('after the release');
    const spot = await A.findFree(dSite.cx, dSite.cy);
    expect(spot, 'findFree returns the released chunk').toEqual({ cx: dSite.cx, cy: dSite.cy });
    const E = await TestClient.connect('Eve');
    expect(E.claims.has(dKey), "a new client's welcome lists D's chunk").toBe(false);
    const eFunds = E.stats!.funds,
      nE = E.toasts.length;
    expect(await E.tryClaim(dSite.cx, dSite.cy), 'E claims the released chunk').toBe(true);
    await E.toastAfter(nE, /^success: Welcome, Mayor!.*with the 6 zones and buildings already standing there/);
    await sleep(ticks(6));
    intact('after E claimed it');
    expect(E.stats!.chunks).toBe(1);
    // the first plot is free and the buildings cost nothing extra (E's new road and zone upkeep aside: frozen or
    // not, a few ticks of an unpowered city cost at most a few dollars)
    expect(eFunds - E.stats!.funds, 'what E paid for the plot and its buildings').toBeLessThanOrEqual(100);
  });
});
