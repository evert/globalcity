// Feature test: power trading across a chunk border, leaderboard, budget, fire (via the devIgnite dev hook).
import { describe, it, expect, beforeAll } from 'vitest';
import {
  CHUNK,
  LOMASK,
  FIRE,
  LASTFIRE,
  RUBBLE,
  LASTRUBBLE,
  lonLatToTile,
  chunkOf,
  chunkKey,
  isWater,
  type LeaderboardEntry,
  type ServerMsg,
} from '@globalcity/shared';
import { TestClient, resetServer, sleep, waitFor, ticks, TICK } from './support/client.ts';

// Seed locations to look for two adjacent free chunks with enough flat land.
const SEEDS: [number, number][] = [
  [-0.1, 51.5],
  [2.35, 48.85],
  [13.4, 52.5],
  [-3.7, 40.4],
  [21.0, 52.2],
  [30.5, 50.45],
  [37.6, 55.75],
  [-94.6, 39.1],
  [-87.6, 41.9],
  [-104.9, 39.7],
  [-46.6, -23.5],
  [151.2, -33.9],
  [116.4, 39.9],
  [77.2, 28.6],
  [3.4, 6.5],
  [28.0, -26.2],
  [-99.1, 19.4],
  [-58.4, -34.6],
  [105.8, 21.0],
  [44.4, 33.3],
];

// Layout (Y = top row). A owns chunk (cx,cy), B owns (cx+1,cy); the border is between columns cx*64+63 and (cx+1)*64.
//   A: coal plant cols 58..61 rows Y..Y+3; wires cols 62,63 row Y+1; res zone cols 58..60 rows Y+4..Y+6; road row Y+7 cols 58..63
//   B: wires cols 0,1 row Y+1; res zones cols 2-4, 5-7, 8-10 rows Y..Y+2; fire station cols 11..13; road row Y+4 cols 0..13
const A_COLS = 6,
  A_ROWS = 8,
  B_COLS = 14,
  B_ROWS = 5;

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

/** Funds and "last month" income as each new month starts (stats arrive after the tick's time message). */
function newMonths(c: TestClient): { funds: number; lastIncome: number }[] {
  const out: { funds: number; lastIncome: number }[] = [];
  let month = -1,
    last = -1;
  for (const m of c.log) {
    if (m.t === 'time') month = m.time.month;
    else if (m.t === 'stats' && month >= 0 && month !== last) {
      out.push({ funds: m.stats.funds, lastIncome: m.stats.lastIncome });
      last = month;
    }
  }
  return out;
}
/** Fire tiles in the 'tiles' updates this client received. */
function fireTilesSeen(c: TestClient): number {
  let n = 0;
  for (const m of c.log)
    if (m.t === 'tiles')
      for (let k = 2; k < m.u.length; k += 3) {
        const id = m.u[k] & LOMASK;
        if (id >= FIRE && id <= LASTFIRE) n++;
      }
  return n;
}
type Leaderboard = Extract<ServerMsg, { t: 'leaderboard' }>;

describe('features', () => {
  let A: TestClient, B: TestClient;
  let cx: number, cy: number, Y: number, AX: number, BX: number;
  beforeAll(async () => {
    await resetServer();
    A = await TestClient.connect('Exporter-A');
    B = await TestClient.connect('Importer-B');
  });

  it('sends a leaderboard after welcome', () => {
    expect(A.log.some((m) => m.t === 'leaderboard')).toBe(true);
  });

  it('builds a plant on one side of a chunk border and homes on the other', async () => {
    let site: { cx: number; cy: number; Y: number } | null = null;
    for (const [lon, lat] of SEEDS) {
      const t = lonLatToTile(lon, lat);
      const c = chunkOf(t.x, t.y);
      const a = await A.findFree(c.cx, c.cy);
      if (!a || a.cx + 1 >= 128) continue;
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
    AX = (cx + 1) * CHUNK - A_COLS; // A's first column
    BX = (cx + 1) * CHUNK; // B's first column

    A.send({ t: 'claim', cx, cy });
    B.send({ t: 'claim', cx: cx + 1, cy });
    await waitFor(() => A.claims.get(chunkKey(cx, cy))?.ownerId === A.id && B.claims.get(chunkKey(cx + 1, cy))?.ownerId === B.id, 'claims');
    A.send({
      t: 'sub',
      chunks: [
        [cx, cy],
        [cx + 1, cy],
      ],
    });

    A.send({ t: 'build', tool: 'coal', x: AX + 1, y: Y + 1 });
    A.send({ t: 'build', tool: 'wire', x: AX + 4, y: Y + 1 });
    A.send({ t: 'build', tool: 'wire', x: AX + 5, y: Y + 1 });
    A.send({ t: 'build', tool: 'residential', x: AX + 1, y: Y + 5 });
    for (let dx = 0; dx < A_COLS; dx++) A.send({ t: 'build', tool: 'road', x: AX + dx, y: Y + 7 });
    B.send({ t: 'build', tool: 'wire', x: BX, y: Y + 1 });
    B.send({ t: 'build', tool: 'wire', x: BX + 1, y: Y + 1 });
    B.send({ t: 'build', tool: 'residential', x: BX + 3, y: Y + 1 });
    B.send({ t: 'build', tool: 'residential', x: BX + 6, y: Y + 1 });
    B.send({ t: 'build', tool: 'residential', x: BX + 9, y: Y + 1 });
    B.sendRaw({ t: 'devPeak', pop: 20000 }); // fire stations unlock at 15,000 people
    await sleep(200);
    B.send({ t: 'build', tool: 'fire', x: BX + 12, y: Y + 1 });
    for (let dx = 0; dx < B_COLS; dx++) B.send({ t: 'build', tool: 'road', x: BX + dx, y: Y + 4 });
    await sleep(500);
    for (const c of [A, B]) expect(c.hasToast(/^error/), `${c.name} error toasts: ${c.toastText()}`).toBe(false);
  });

  it('trades power across the border', async () => {
    await waitFor(() => (B.stats?.powerImported ?? 0) > 0 && (A.stats?.powerExported ?? 0) > 0, 'powerImported/powerExported > 0', ticks(20));
    const bs = B.stats!,
      as0 = A.stats!;
    expect(bs.powerImported, 'B imports (3 res zones + station)').toBeGreaterThanOrEqual(3);
    expect(bs.powerSupply, 'B has no plant').toBe(0);
    expect(as0.powerExported, 'exported = imported').toBe(bs.powerImported);
    expect(as0.powerTradeNet).toBeGreaterThan(0);
    expect(bs.powerTradeNet).toBeLessThan(0);
    await sleep(ticks(3));
    // upkeep (plant + roads) can outweigh a tiny trade, so only the trade itself is asserted
    expect(A.stats!.powerTradeNet, 'A trade income goes on').toBeGreaterThan(0);
    await waitFor(() => B.hasToast(/^info: Buying \d+ units of power from Exporter-A/), 'B buying toast', ticks(2));
    await waitFor(() => A.hasToast(/^info: Selling \d+ units of power to Importer-B/), 'A selling toast', ticks(2));
    expect(B.toasts.filter((t) => t.msg.startsWith('Buying')).length, 'exactly one Buying toast so far').toBe(1);
  });

  it("counts the power bought in B's last month", async () => {
    // over a whole month B builds nothing, so its funds move by exactly that much
    const seen = newMonths(B).length;
    await waitFor(() => newMonths(B).length >= seen + 2, 'two new months for B', ticks(26));
    const [m0, m1] = newMonths(B).slice(seen, seen + 2);
    expect(m1.funds - m0.funds, 'funds change over the month').toBe(m1.lastIncome);
  });

  it('lists both cities on the leaderboard', async () => {
    await waitFor(() => (A.stats?.population ?? 0) > 0 && (B.stats?.population ?? 0) > 0, 'both populations > 0', ticks(30));
    let lb: Leaderboard | null = null;
    const t0 = Date.now();
    while (Date.now() - t0 < ticks(25)) {
      const n = B.log.length;
      B.send({ t: 'leaderboard' });
      const got = await waitFor(() => B.log.slice(n).find((m): m is Leaderboard => m.t === 'leaderboard'), 'leaderboard reply');
      if (got.entries.some((e) => e.id === A.id) && got.entries.some((e) => e.id === B.id)) {
        lb = got;
        break;
      }
      await sleep(TICK);
    }
    expect(lb, 'the leaderboard lists both A and B').not.toBeNull();
    const ea = lb!.entries.find((e) => e.id === A.id)!,
      eb = lb!.entries.find((e) => e.id === B.id)!;
    expect({ a: [ea.cx, ea.cy], b: [eb.cx, eb.cy] }, 'leaderboard centroids').toEqual({ a: [cx, cy], b: [cx + 1, cy] });
    expect(lb!.me, 'me').toBeDefined();
    expect(lb!.me!.rank).toBeGreaterThanOrEqual(1);
    expect(lb!.me!.population).toBeGreaterThan(0);
    const pops = lb!.entries.map((e: LeaderboardEntry) => e.population);
    expect(pops, 'sorted').toEqual([...pops].sort((x, y) => y - x));
  });

  it('keeps the budget by year', async () => {
    // The year so far fills in month by month; A has a plant and roads, so power and road upkeep show. Bulldozing a
    // road tile ($1) is construction spending in the current year. Start in a fresh year, so the founding year's
    // building isn't in this year's construction.
    const startYear = A.stats!.budget!.current.year;
    await waitFor(() => (A.stats?.budget?.current.year ?? 0) > startYear, 'a new year for A', ticks(14));
    A.send({ t: 'build', tool: 'bulldozer', x: AX + 1, y: Y + 7 });
    await waitFor(
      () => {
        const c = A.stats?.budget?.current;
        return !!c && c.taxes > 0 && c.power > 0 && c.roads > 0 && c.construction > 0;
      },
      'A has taxes, upkeep lines and construction this year',
      ticks(14),
    );
    expect(A.stats!.budget!.current.construction, 'construction is the $1 bulldoze').toBe(1);
    // a completed year lands in the history with the same lines, oldest first and never the current year
    const had = A.stats!.budget!.years.length;
    await waitFor(() => (A.stats?.budget?.years.length ?? 0) > had, 'a year closed for A', ticks(14));
    const ys = A.stats!.budget!.years,
      last = ys[ys.length - 1];
    expect(last.year, 'the last closed year is the year before').toBe(A.stats!.budget!.current.year - 1);
    expect(last.taxes).toBeGreaterThan(0);
    expect(last.power).toBeGreaterThan(0);
    expect(last.roads).toBeGreaterThan(0);
    for (let k = 1; k < ys.length; k++) expect(ys[k].year, 'history years are consecutive').toBe(ys[k - 1].year + 1);
  });

  it('burns a zone down to rubble and puts the fire out', async () => {
    const fx = BX + 6,
      fy = Y + 1; // centre of B's middle residential zone
    B.sendRaw({ t: 'devIgnite', x: fx, y: fy });
    await waitFor(
      () => fireTilesSeen(B) > 0 && (B.tile(fx, fy)! & LOMASK) >= FIRE && (B.tile(fx, fy)! & LOMASK) <= LASTFIRE,
      'fire tile in tiles update',
      ticks(2),
    );
    await waitFor(() => (B.stats?.fires ?? 0) > 0, 'stats.fires > 0', ticks(2));
    // building on fire must be refused (fire tiles are not bulldozable either)
    B.send({ t: 'build', tool: 'bulldozer', x: fx, y: fy });
    await waitFor(() => (B.stats?.fires ?? 0) === 0, 'stats.fires back to 0', ticks(60));
    await waitFor(() => B.hasToast(/^success: The fire is out\./), 'fire out toast', ticks(2));
    let rubble = 0,
      fireLeft = 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const id = B.tile(fx + dx, fy + dy)! & LOMASK;
        if (id >= RUBBLE && id <= LASTRUBBLE) rubble++;
        if (id >= FIRE && id <= LASTFIRE) fireLeft++;
      }
    expect(fireLeft, 'fire tiles left although stats.fires is 0').toBe(0);
    expect(rubble, 'the 3x3 footprint is rubble').toBeGreaterThanOrEqual(8);
  });
});
