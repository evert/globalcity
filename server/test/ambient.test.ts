// Ambient test: animation flags (coal/industrial smoke, airport radar, nuclear swirl, stadium games), traffic tiles,
// special-building counts and police stations. Takes ~1-2 minutes (a stadium game is a 1/32 chance per tick).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  CHUNK,
  LOMASK,
  ANIMBIT,
  ZONEBIT,
  LTRFBASE,
  LASTROAD,
  POLICE_RANGE,
  COALSMOKE1,
  COALSMOKE4,
  RADAR0,
  NUKESWIRL1,
  FULLSTADIUM,
  IZB,
  SMOKEBASE,
  COALBASE,
  POWERPLANT,
  COAL_POWER,
  NUCLEAR_POWER,
  IND_SMOKE,
  ANI_TILE,
  lonLatToTile,
  chunkOf,
  isWater,
  isRoad,
  isRubble,
  roadPiece,
} from '@globalcity/shared';
import { TestClient, resetServer, waitFor, ticks, sleep, TICK } from './support/client.ts';

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

// Layout, origin (X,Y) = top-left of a 25 x 13 land rectangle. Everything is powered from the coal plant through
// wires and conductive footprints.
//   rows Y..Y+5   : coal X..X+3 | wire X+4 (row Y+1) | airport X+5..X+10 | wire X+11 | stadium X+12..X+15 | wire X+16 | stadium X+17..X+20 | wire X+21 | police X+22..X+24
//   rows Y+4..Y+6 : wire column at X+1 from the plant down to the zones
//   rows Y+7..Y+9 : res X..X+2 | com X+3..X+5 | res X+6..X+8 | com X+9..X+11 | wires X+12..X+14 (row Y+8) | ind X+15..X+17 | nuclear X+19..X+22 (rows Y+7..Y+10)
//   row Y+11      : road X..X+24 ; row Y+12 free (a branch road is added during the test)
const RW = 25,
  RH = 13;

/** A RW x RH rectangle with no water, zone or road tile. */
function findRect(tiles: Uint32Array): { ox: number; oy: number } | null {
  for (let oy = 1; oy + RH < CHUNK - 1; oy++) {
    cols: for (let ox = 1; ox + RW < CHUNK - 1; ox++) {
      for (let dy = 0; dy < RH; dy++)
        for (let dx = 0; dx < RW; dx++) {
          const v = tiles[(oy + dy) * CHUNK + ox + dx];
          if (isWater(v) || v & ZONEBIT || isRoad(v)) continue cols;
        }
      return { ox, oy };
    }
  }
  return null;
}

const idOf = (v: number): number => v & LOMASK;
const anim = (v: number): boolean => (v & ANIMBIT) !== 0;
const isTrafficTile = (v: number): boolean => idOf(v) >= LTRFBASE && idOf(v) <= LASTROAD;

/** Every value tile (x, y) has had in the 'tiles' messages this client got. */
function seenAt(c: TestClient, x: number, y: number): number[] {
  const out: number[] = [];
  for (const m of c.log) if (m.t === 'tiles') for (let k = 0; k < m.u.length; k += 3) if (m.u[k] === x && m.u[k + 1] === y) out.push(m.u[k + 2]);
  return out;
}

describe('ambient', () => {
  let A: TestClient;
  let X = 0,
    Y = 0;
  let builtAt = 0;
  let pump: NodeJS.Timeout | undefined;
  const tile = (x: number, y: number): number => A.tile(x, y) ?? -1;
  // positions of interest (centres = footprint top-left + (1,1)), set once the site is known
  let coal: { x: number; y: number }, airport: { x: number; y: number }, police: { x: number; y: number };
  let stadiums: { x: number; y: number }[];
  let zones: { tool: 'residential' | 'commercial'; x: number }[];
  let ZY = 0,
    ROAD_Y = 0;
  let ind: { x: number; y: number }, indWire: { x: number; y: number }, nuclear: { x: number; y: number };
  let smokeCells: { x: number; y: number }[];
  const roadTiles = (): number[] => Array.from({ length: RW }, (_, dx) => tile(X + dx, ROAD_Y));

  beforeAll(async () => {
    await resetServer();
    A = await TestClient.connect('Ambient-A');
  });
  afterAll(() => clearInterval(pump));

  it('has an animation cycle for every traffic tile', () => {
    // every traffic variant we may write (pieces 2..14, light and heavy, frame 0) is animated
    for (let piece = 2; piece <= 14; piece++)
      for (const base of [80, 144]) expect(ANI_TILE[base + piece], `ANI_TILE cycle for traffic tile ${base + piece}`).not.toBe(base + piece);
  });

  it('builds a powered town with specials', async () => {
    let site: { cx: number; cy: number } | null = null;
    for (const [lon, lat] of SEEDS) {
      const t = lonLatToTile(lon, lat);
      const c = chunkOf(t.x, t.y);
      const a = await A.findFree(c.cx, c.cy);
      if (!a) continue;
      await A.subscribe([[a.cx, a.cy]]);
      const r = findRect(A.chunk(a.cx, a.cy));
      if (!r) continue;
      site = a;
      X = a.cx * CHUNK + r.ox;
      Y = a.cy * CHUNK + r.oy;
      break;
    }
    expect(site, `a free chunk with a ${RW}x${RH} land rectangle`).not.toBeNull();
    await A.claim(site!.cx, site!.cy);
    A.sendRaw({ t: 'devFunds', amount: 200_000 });
    A.sendRaw({ t: 'devPeak', pop: 1_100_000 }); // seaport/airport are milestone buildings
    await waitFor(() => (A.stats?.funds ?? 0) > 100_000, 'devFunds');

    coal = { x: X + 1, y: Y + 1 };
    airport = { x: X + 6, y: Y + 1 };
    stadiums = [
      { x: X + 13, y: Y + 1 },
      { x: X + 18, y: Y + 1 },
    ];
    police = { x: X + 23, y: Y + 1 };
    zones = [
      { tool: 'residential', x: X + 1 },
      { tool: 'commercial', x: X + 4 },
      { tool: 'residential', x: X + 7 },
      { tool: 'commercial', x: X + 10 },
    ];
    ZY = Y + 8;
    ind = { x: X + 16, y: ZY };
    indWire = { x: X + 13, y: ZY };
    nuclear = { x: X + 20, y: ZY };
    ROAD_Y = Y + 11;
    smokeCells = [
      { x: coal.x + 1, y: coal.y - 1 },
      { x: coal.x + 2, y: coal.y - 1 },
      { x: coal.x + 1, y: coal.y },
      { x: coal.x + 2, y: coal.y },
    ];

    await A.build('coal', coal.x, coal.y);
    await A.build('wire', X + 4, Y + 1);
    await A.build('airport', airport.x, airport.y);
    await A.build('wire', X + 11, Y + 1);
    await A.build('stadium', stadiums[0].x, stadiums[0].y);
    await A.build('wire', X + 16, Y + 1);
    await A.build('stadium', stadiums[1].x, stadiums[1].y);
    await A.build('wire', X + 21, Y + 1);
    await A.build('police', police.x, police.y);
    for (let dy = 4; dy <= 6; dy++) await A.build('wire', X + 1, Y + dy);
    for (const z of zones) await A.build(z.tool, z.x, ZY);
    for (let dx = 12; dx <= 14; dx++) await A.build('wire', X + dx, ZY);
    await A.build('industrial', ind.x, ind.y);
    await A.build('nuclear', nuclear.x, nuclear.y);
    for (let dx = 0; dx < RW; dx++) await A.build('road', X + dx, ROAD_Y);
    await sleep(500);
    expect(
      A.toasts.filter((t) => t.kind === 'error'),
      'error toasts while building',
    ).toEqual([]);
    builtAt = Date.now();
  });

  it('animates coal smoke, the radar and the swirl, and counts specials and police', async () => {
    await waitFor(
      () => smokeCells.every((c) => anim(tile(c.x, c.y)) && idOf(tile(c.x, c.y)) >= COALSMOKE1 && idOf(tile(c.x, c.y)) <= COALSMOKE4 + 3),
      'coal smoke tiles',
      ticks(3),
    );
    const radar = { x: airport.x + 1, y: airport.y - 1 };
    const swirl = { x: nuclear.x, y: nuclear.y + 1 };
    await waitFor(() => anim(tile(radar.x, radar.y)) && idOf(tile(radar.x, radar.y)) === RADAR0, 'airport radar tile', ticks(3));
    await waitFor(() => anim(tile(swirl.x, swirl.y)) && idOf(tile(swirl.x, swirl.y)) === NUKESWIRL1, 'nuclear swirl tile', ticks(3));
    // the airport only counts when another mayor has one to fly to (flights.test.ts covers that), so 0 or 1 here
    await waitFor(
      () => A.stats?.policeStations === 1 && A.stats.specials.airport <= 1 && A.stats.specials.stadium === 2,
      'stats.policeStations/specials',
      ticks(3),
    );
    const s0 = A.stats!;
    expect(s0.powerSupply, 'one coal plant + one nuclear plant').toBe(COAL_POWER + NUCLEAR_POWER);
    expect(s0.specials.seaport, 'no seaport was built').toBe(0);
    const q = await A.query(police.x, police.y);
    expect(q.name).toBe(`Police station (covers ${POLICE_RANGE} tiles)`);
    expect(q.powered).toBeTruthy();
  });

  it('shows traffic on the roads, kept when a road is re-tabled', async () => {
    // A test town is far too small to jam its roads under the real trip rules, so pump density in through the dev
    // hook (one burst per tick) until the zones go and the roads must clear.
    pump = setInterval(() => {
      for (let dx = 0; dx < RW; dx++) A.sendRaw({ t: 'devTraffic', x: X + dx, y: ROAD_Y, amount: 255 });
    }, TICK);
    await waitFor(() => roadTiles().some((v) => isTrafficTile(v)) && (A.stats?.traffic ?? 0) > 0, 'traffic tiles and stats.traffic > 0', ticks(15));
    for (const v of roadTiles()) {
      expect(isRoad(v), `road tile lost: ${idOf(v)}`).toBe(true);
      expect(anim(v), `ANIMBIT on road tile ${v.toString(16)}`).toBe(isTrafficTile(v));
      if (isTrafficTile(v)) expect(ANI_TILE[idOf(v)], `traffic tile ${idOf(v)} has an animation cycle`).not.toBe(idOf(v));
    }
    // a branch below the road turns the tile above into a T junction at the same level
    const bx = X + 5;
    const before = tile(bx, ROAD_Y);
    await A.build('road', bx, ROAD_Y + 1);
    await waitFor(() => roadPiece(idOf(tile(bx, ROAD_Y))) === 10, 'T junction piece (ROADS9) above the branch', ticks(1));
    const after = tile(bx, ROAD_Y);
    expect(isTrafficTile(before) && !isTrafficTile(after) && !isTrafficTile(tile(bx, ROAD_Y)), 're-tabling dropped the traffic level').toBe(false);
    await A.query(bx, ROAD_Y);
  });

  it('puffs industrial smoke while powered', { timeout: ticks(120) + 30_000 }, async () => {
    await waitFor(() => idOf(tile(ind.x, ind.y)) >= IZB, 'industrial building', ticks(120));
    const indId = idOf(tile(ind.x, ind.y));
    const variant = ((indId - IZB) >> 3) & 7;
    const e = IND_SMOKE[variant];
    if (e.animates) {
      const cells = [e.a, e.b].map((s) => ({ x: ind.x + s.dx, y: ind.y + s.dy, on: s.on }));
      await waitFor(() => cells.every((c) => anim(tile(c.x, c.y)) && idOf(tile(c.x, c.y)) === c.on), 'industrial smoke tiles', ticks(3));
      await A.build('bulldozer', indWire.x, indWire.y);
      await waitFor(
        () => cells.every((c) => !anim(tile(c.x, c.y)) && idOf(tile(c.x, c.y)) < SMOKEBASE),
        'industrial smoke off after the wire was cut',
        ticks(4),
      );
    } else {
      await A.build('bulldozer', indWire.x, indWire.y);
    }
  });

  it('lets traffic decay when the zones go', { timeout: ticks(45) + 30_000 }, async () => {
    clearInterval(pump);
    for (const z of zones) await A.build('bulldozer', z.x, ZY);
    await sleep(300);
    for (const z of zones) expect(isRubble(tile(z.x, ZY)), `zone at ${z.x},${ZY} bulldozed`).toBe(true);
    await waitFor(
      () => roadTiles().every((v) => isRoad(v) && !isTrafficTile(v) && !anim(v)) && A.stats?.traffic === 0,
      'plain roads and stats.traffic = 0',
      ticks(45),
    );
  });

  it('plays stadium games', { timeout: ticks(250) + 30_000 }, async () => {
    // p = 1/32 per powered stadium per tick; two stadiums
    const sawGame = (): boolean => stadiums.some((s) => seenAt(A, s.x, s.y).some((v) => idOf(v) === FULLSTADIUM));
    const left = Math.max(0, ticks(250) - (Date.now() - builtAt));
    await waitFor(sawGame, 'FULLSTADIUM centre tile', left + 1000);
    // the game tiles (932 and 940, ANIMBIT) must have been placed with every game; a game lasts ~8 ticks so check the history
    const played = stadiums.find((s) => seenAt(A, s.x, s.y).some((v) => idOf(v) === FULLSTADIUM))!;
    const seenGame = (dx: number, dy: number, id: number): boolean => seenAt(A, played.x + dx, played.y + dy).some((v) => idOf(v) === id && anim(v));
    expect(seenGame(1, 0, 932) && seenGame(1, 1, 940), 'FOOTBALLGAME tiles with ANIMBIT placed with the game').toBe(true);
    const full = stadiums.find((s) => idOf(tile(s.x, s.y)) === FULLSTADIUM);
    if (full) expect((await A.query(full.x + 1, full.y)).name).toMatch(/Stadium \(game on!\)/);
  });

  it('bulldozes the whole plant from a smoke tile', async () => {
    await A.build('bulldozer', smokeCells[0].x, smokeCells[0].y);
    await waitFor(() => isRubble(tile(coal.x, coal.y)) && smokeCells.every((c) => isRubble(tile(c.x, c.y))), 'coal plant rubble', ticks(1));
    expect(idOf(tile(coal.x - 1, coal.y - 1)) === COALBASE || idOf(tile(coal.x, coal.y)) === POWERPLANT, 'coal plant footprint left behind').toBe(false);
  });
});
