// Headless-ish self test (open /#selftest): renders a synthetic 2x2 chunk area with the
// procedural sprite sheet to an offscreen canvas, then drives the DOM UI with synthetic server
// messages (leaderboard, power trade stats, clickable fire toasts, fire animation, presence, city
// names, abandonment, neighbour demand) and logs "selftest ok" or throws. Also exports the synthetic
// data sets used by /#demo-leaderboard and /#demo-social.
import type { ClaimInfo, LeaderboardEntry, PlayerStats, Presence, ServerMsg } from '@globalcity/shared';
import {
  ABANDON_IDLE_DAYS,
  ABANDON_FREE_DAYS,
  CHUNK,
  LOMASK,
  PWRBIT,
  ZONEBIT,
  RESBASE,
  FREEZ,
  ROADS,
  RIVER,
  WOODS,
  DIRT,
  CONDBIT,
  BULLBIT,
  FIRE,
  BURNBIT,
  MAX_CHUNKS_PER_PLAYER,
  ANIMBIT,
  LASTFIRE,
  COALSMOKE1,
  LTRFBASE,
  FOUNTAIN,
  LHRAIL,
  LVRAIL,
  LVRAIL2,
  LVRAIL3,
  LVRAIL4,
  LVRAIL5,
  LVRAIL8,
  LVRAIL10,
  COALBASE,
  PORTBASE,
  AIRPORTBASE,
  POWERPLANT,
  PORT,
  AIRPORT,
  RADAR0,
  COAL_SMOKE,
  STADIUM_GAME,
  HTRFBASE,
  NUCLEARBASE,
  NUKE_SWIRL,
  HROADPOWER,
  LHPOWER,
  FULLSTADIUMBASE,
  FULLSTADIUM,
  NUCLEAR,
} from '@globalcity/shared';
import { ANI_TILE } from './anim.ts';
import { Actions } from './actions.ts';
import { proceduralMinimap, proceduralSheet } from './assets.ts';
import { handleServerMsg, type DispatchTargets } from './dispatch.ts';
import { TileMap } from './map.ts';
import { Net } from './net.ts';
import { ViewReporter, VIEW_INTERVAL_MS } from './presence.ts';
import { Renderer } from './renderer.ts';
import { AppState, claimLabel } from './state.ts';
import { NEIGHBOUR_HELP, UI } from './ui.ts';
import { SpriteEngine, type SpriteView } from './sprites.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`selftest: ${msg}`);
}

export function baseStats(over: Partial<PlayerStats> = {}): PlayerStats {
  return {
    funds: 20000,
    population: 0,
    resPop: 0,
    comPop: 0,
    indPop: 0,
    powerSupply: 0,
    powerDemand: 1,
    demand: { r: 0.5, c: -0.2, i: 0.1 },
    chunks: 1,
    lastIncome: 0,
    powerImported: 0,
    powerExported: 0,
    powerTradeNet: 0,
    fires: 0,
    fireStations: 0,
    neighbours: 0,
    neighbourDemand: { r: 0, c: 0, i: 0 },
    railLinks: 0,
    railDemand: 0,
    crime: 0,
    policeStations: 0,
    specials: { stadium: 0, seaport: 0, airport: 0 },
    traffic: 0,
    peakPop: 0,
    nextMilestone: 2000,
    unlocked: [],
    built: {},
    cityHall: 0,
    debt: 0,
    lifelineAvailable: false,
    ...over,
  };
}

/** Claim with the optional-ish new fields defaulted (old servers omit cityName / idleDays). */
export function claim(cx: number, cy: number, ownerId: string, ownerName: string, color: string, pop: number, over: Partial<ClaimInfo> = {}): ClaimInfo {
  return { cx, cy, ownerId, ownerName, cityName: '', color, pop, idleDays: 0, ...over };
}

function syntheticChunk(cx: number, cy: number): Uint32Array {
  const t = new Uint32Array(CHUNK * CHUNK);
  for (let y = 0; y < CHUNK; y++)
    for (let x = 0; x < CHUNK; x++) {
      let v = DIRT;
      if ((x + y + cx) % 7 === 0) v = WOODS | BULLBIT;
      if (y < 4) v = RIVER;
      if (x === 20) v = ROADS | BULLBIT | CONDBIT;
      t[y * CHUNK + x] = v;
    }
  // a residential zone with the centre flagged, unpowered
  for (let dy = 0; dy < 3; dy++)
    for (let dx = 0; dx < 3; dx++) {
      const id = RESBASE + dy * 3 + dx;
      t[(30 + dy) * CHUNK + 30 + dx] = id | (id === FREEZ ? ZONEBIT : 0) | (cy === 1 ? PWRBIT : 0);
    }
  return t;
}

export const DEMO_LEADERBOARD: LeaderboardEntry[] = [
  { id: 'p1', name: 'Hanzo', cityName: 'Kyoto', color: '#ff5f5f', population: 184_320, chunks: 9, cx: 92, cy: 20, fires: 0, milestones: 100 },
  { id: 'p2', name: 'Lena', cityName: 'Eindhoven', color: '#4dd0e1', population: 121_900, chunks: 6, cx: 66, cy: 15, fires: 3, milestones: 82 },
  { id: 'me', name: 'Tester', cityName: 'Tilburg', color: '#58c4ff', population: 64_210, chunks: 4, cx: 30, cy: 22, fires: 2, milestones: 64 },
  { id: 'p4', name: 'Oluwaseun', cityName: 'Lagos', color: '#7ddc5c', population: 40_010, chunks: 3, cx: 70, cy: 36, fires: 0, milestones: 45 },
  { id: 'p5', name: 'Marta', cityName: 'Porto', color: '#ffb347', population: 22_400, chunks: 2, cx: 69, cy: 14, fires: 1, milestones: 36 },
  { id: 'p6', name: 'Yusuf', cityName: 'Izmir', color: '#b47aff', population: 9_870, chunks: 2, cx: 80, cy: 18, fires: 0, milestones: 27 },
  { id: 'p7', name: 'Ada', cityName: '', color: '#ff7ad9', population: 3_120, chunks: 1, cx: 60, cy: 17, fires: 0, milestones: 9 },
  { id: 'p8', name: 'Kenji', cityName: 'Sendai', color: '#9be564', population: 980, chunks: 1, cx: 110, cy: 20, fires: 0, milestones: 0 },
];

/** Claims for the social demo: my two-plot city, a neighbour, an abandoned plot and an idle one, all around chunk (31,23). */
export const DEMO_SOCIAL_CLAIMS: ClaimInfo[] = [
  claim(30, 22, 'me', 'Tester', '#58c4ff', 64_210, { cityName: 'Tilburg' }),
  claim(30, 23, 'me', 'Tester', '#58c4ff', 64_210, { cityName: 'Tilburg' }),
  claim(31, 22, 'p2', 'Lena', '#4dd0e1', 121_900, { cityName: 'Eindhoven' }),
  claim(31, 23, 'p9', 'Ghost', '#ffb347', 3_400, { cityName: 'Old Harbour', idleDays: 41 }),
  claim(32, 23, 'p6', 'Yusuf', '#b47aff', 9_870, { cityName: 'Izmir', idleDays: 12 }),
];

export const DEMO_PRESENCE: Presence[] = [
  {
    id: 'p2',
    name: 'Lena',
    cityName: 'Eindhoven',
    color: '#4dd0e1',
    x: 31 * CHUNK + 20,
    y: 22 * CHUNK + 40,
    zoom: 1,
    cx: 31 * CHUNK + 14,
    cy: 22 * CHUNK + 52,
  },
  { id: 'p1', name: 'Hanzo', cityName: 'Kyoto', color: '#ff5f5f', x: 30 * CHUNK + 50, y: 23 * CHUNK + 10, zoom: 2, cx: 30 * CHUNK + 46, cy: 23 * CHUNK + 14 },
  { id: 'p6', name: 'Yusuf', cityName: 'Izmir', color: '#b47aff', x: 31 * CHUNK + 30, y: 23 * CHUNK + 12, zoom: 0.5 }, // looking, not pointing
  { id: 'p4', name: 'Oluwaseun', cityName: 'Lagos', color: '#7ddc5c', x: 70 * CHUNK, y: 36 * CHUNK, zoom: 1, cx: 70 * CHUNK + 5, cy: 36 * CHUNK + 5 }, // far away
];

/** Feed the UI a believable offline data set (used by /#demo-leaderboard and the self test). */
export function demoLeaderboard(t: DispatchTargets): void {
  const feed = (m: ServerMsg) => handleServerMsg(m, t);
  feed({
    t: 'welcome',
    player: { id: 'me', name: 'Tester', cityName: 'Tilburg', color: '#58c4ff', token: 'x' },
    stats: baseStats({
      funds: 48_200,
      population: 64_210,
      resPop: 40_000,
      comPop: 14_000,
      indPop: 10_210,
      powerSupply: 120,
      powerDemand: 131,
      powerImported: 11,
      powerExported: 0,
      powerTradeNet: -11,
      chunks: 4,
      fires: 2,
      fireStations: 1,
    }),
    world: { w: 8192, h: 4096, chunk: 64 },
    claims: [
      claim(30, 22, 'me', 'Tester', '#58c4ff', 64_210, { cityName: 'Tilburg' }),
      claim(31, 22, 'me', 'Tester', '#58c4ff', 64_210, { cityName: 'Tilburg' }),
      claim(92, 20, 'p1', 'Hanzo', '#ff5f5f', 184_320, { cityName: 'Kyoto' }),
      claim(66, 15, 'p2', 'Lena', '#4dd0e1', 121_900, { cityName: 'Eindhoven' }),
    ],
    online: 7,
    time: { year: 1934, month: 5 },
  });
  feed({ t: 'leaderboard', entries: DEMO_LEADERBOARD, me: { rank: 3, population: 64_210 } });
  feed({ t: 'toast', msg: 'Fire in your city at 1935, 1420!', kind: 'error', at: { x: 1935, y: 1420 } });
  t.ui.openLeaderboard();
}

/** /#demo-social: city-name labels (one abandoned, one idle), other players' cursors, neighbour/rail boost, at zoom 1.
 *  /#demo-social-overview: the same data zoomed out (viewport rectangles, short labels). */
export function demoSocial(t: DispatchTargets, overview = false): void {
  const feed = (m: ServerMsg) => handleServerMsg(m, t);
  for (let cy = 22; cy <= 23; cy++) for (let cx = 30; cx <= 32; cx++) t.map.setChunk(cx, cy, syntheticChunk(cx, cy));
  feed({
    t: 'welcome',
    player: { id: 'me', name: 'Tester', cityName: '', color: '#58c4ff', token: 'x' },
    stats: baseStats({
      funds: 48_200,
      population: 64_210,
      resPop: 40_000,
      comPop: 14_000,
      indPop: 10_210,
      powerSupply: 120,
      powerDemand: 110,
      demand: { r: 0.45, c: 0.7, i: 0.3 },
      chunks: 2,
      neighbours: 2,
      neighbourDemand: { r: 0.15, c: 0.2, i: 0.1 },
      railLinks: 1,
      railDemand: 0.1,
    }),
    world: { w: 8192, h: 4096, chunk: 64 },
    claims: DEMO_SOCIAL_CLAIMS,
    online: 5,
    time: { year: 1934, month: 5 },
  });
  feed({ t: 'leaderboard', entries: DEMO_LEADERBOARD, me: { rank: 3, population: 64_210 } });
  feed({ t: 'presence', players: DEMO_PRESENCE });
  // the four-corner point where my plots, Eindhoven and the abandoned Old Harbour meet; a bit down-right so all four labels fit
  if (overview) t.renderer.setCamera(31 * CHUNK + 32, 23 * CHUNK, 0.25);
  else t.renderer.setCamera(31 * CHUNK + 6, 23 * CHUNK + 2, 1);
  // keep the presence frame fresh for screenshots (the real server sends one every PRESENCE_INTERVAL_MS)
  setInterval(() => feed({ t: 'presence', players: DEMO_PRESENCE }), 500);
}

/** /#demo-ambient: one synthetic plot with every animated tile kind and all sprite sources (coal plant + smoke,
 *  traffic road, rail loop, seaport on water, airport, stadium game, nuclear swirl, fountain, fire). */
export function demoAmbient(t: DispatchTargets): void {
  const feed = (m: ServerMsg) => handleServerMsg(m, t);
  const CX = 30,
    CY = 22;
  for (let cy = CY - 1; cy <= CY + 1; cy++) for (let cx = CX - 1; cx <= CX + 1; cx++) t.map.setChunk(cx, cy, syntheticChunk(cx, cy));
  const c = new Uint32Array(CHUNK * CHUNK);
  const set = (x: number, y: number, v: number) => {
    c[y * CHUNK + x] = v;
  };
  for (let y = 0; y < CHUNK; y++) for (let x = 0; x < CHUNK; x++) set(x, y, (x * 7 + y * 3) % 11 === 0 ? WOODS | BULLBIT : DIRT);
  // harbour water: top-right corner
  for (let y = 0; y < 14; y++) for (let x = 40; x < CHUNK; x++) set(x, y, RIVER);
  for (let y = 14; y < CHUNK; y++) for (let x = 58; x < CHUNK; x++) set(x, y, RIVER);
  const building = (base: number, size: number, x0: number, y0: number, centreId: number) => {
    for (let dy = 0; dy < size; dy++)
      for (let dx = 0; dx < size; dx++) {
        const id = base + dy * size + dx;
        set(x0 + dx, y0 + dy, id | BULLBIT | (id === centreId ? ZONEBIT : 0) | PWRBIT | CONDBIT);
      }
  };
  // coal plant (centre at +1,+1) with its four smoke tiles
  building(COALBASE, 4, 10, 8, POWERPLANT);
  for (const sm of COAL_SMOKE) set(11 + sm.dx, 9 + sm.dy, sm.tile | ANIMBIT | PWRBIT | CONDBIT | BULLBIT);
  // seaport on the shore + airport with its radar
  building(PORTBASE, 4, 36, 10, PORT);
  building(AIRPORTBASE, 6, 4, 44, AIRPORT);
  set(5 + 1, 45 - 1, RADAR0 | ANIMBIT | PWRBIT | CONDBIT | BULLBIT);
  // stadium with a game on, nuclear plant with its swirl
  building(FULLSTADIUMBASE, 4, 44, 44, FULLSTADIUM);
  for (const g of STADIUM_GAME) set(45 + g.dx, 45 + g.dy, g.tile | ANIMBIT | PWRBIT | CONDBIT | BULLBIT);
  building(NUCLEARBASE, 4, 50, 30, NUCLEAR);
  set(51 + NUKE_SWIRL.dx, 31 + NUKE_SWIRL.dy, NUKE_SWIRL.tile | ANIMBIT | PWRBIT | CONDBIT | BULLBIT);
  // a road with light traffic, a heavy stretch, an intersection, a wire crossing
  for (let x = 2; x < 56; x++) set(x, 20, (x < 20 ? LTRFBASE + 2 : x < 40 ? HTRFBASE + 2 : ROADS) | ANIMBIT | BULLBIT | CONDBIT);
  for (let y = 14; y < 42; y++) set(30, y, (y === 20 ? LTRFBASE + 12 : LTRFBASE + 3) | ANIMBIT | BULLBIT | CONDBIT);
  set(24, 20, HROADPOWER | BULLBIT | CONDBIT);
  for (let y = 15; y < 20; y++) set(24, y, LHPOWER | BULLBIT | CONDBIT);
  // rail loop + a branch, fountains, a small fire
  for (let x = 6; x <= 26; x++) {
    set(x, 26, (x === 6 ? LVRAIL3 : x === 26 ? LVRAIL4 : LHRAIL) | BULLBIT);
    set(x, 38, (x === 6 ? LVRAIL2 : x === 26 ? LVRAIL5 : LHRAIL) | BULLBIT);
  }
  for (let y = 27; y <= 37; y++) {
    set(6, y, LVRAIL | BULLBIT);
    set(26, y, (y === 32 ? LVRAIL8 : LVRAIL) | BULLBIT);
  }
  for (let x = 27; x <= 40; x++) set(x, 32, LHRAIL | BULLBIT);
  set(30, 32, LVRAIL10 | BULLBIT);
  for (let i = 0; i < 4; i++) set(34 + i, 24, (FOUNTAIN + i) | ANIMBIT | BULLBIT);
  for (let i = 0; i < 3; i++) set(40 + i, 28, (FIRE + i * 3) | ANIMBIT | BURNBIT);
  // some houses so it looks lived in
  for (let dy = 0; dy < 3; dy++)
    for (let dx = 0; dx < 3; dx++) {
      const id = RESBASE + dy * 3 + dx;
      set(36 + dx, 15 + dy, id | BULLBIT | PWRBIT | (id === FREEZ ? ZONEBIT : 0));
    }
  t.map.setChunk(CX, CY, c);
  feed({
    t: 'welcome',
    player: { id: 'me', name: 'Tester', cityName: 'Port Ambient', color: '#58c4ff', token: 'x' },
    stats: baseStats({
      funds: 48_200,
      population: 12_400,
      resPop: 8_000,
      comPop: 2_400,
      indPop: 2_000,
      powerSupply: 120,
      powerDemand: 40,
      demand: { r: 0.6, c: 0.5, i: 0.3 },
      chunks: 1,
      traffic: 0.3,
      crime: 0.6,
      policeStations: 0,
      specials: { stadium: 1, seaport: 1, airport: 1 },
    }),
    world: { w: 8192, h: 4096, chunk: 64 },
    claims: [claim(CX, CY, 'me', 'Tester', '#58c4ff', 12_400, { cityName: 'Port Ambient' })],
    online: 3,
    time: { year: 1952, month: 7 },
  });
  t.renderer.setCamera(CX * CHUNK + 32, CY * CHUNK + 30, 1);
  // headless screenshots (virtual time) do not pump requestAnimationFrame: tick the renderer on a timer so the
  // sprites and tile animations advance in the demo (a real browser renders through rAF as usual)
  setInterval(() => t.renderer.render(), 50);
}

export async function runSelfTest(): Promise<void> {
  const sheet = proceduralSheet();
  const minimap = proceduralMinimap();
  const state = new AppState();
  state.setMe({ id: 'me', name: 'Tester', color: '#58c4ff', cityName: '' });
  state.replaceClaims([claim(0, 0, 'me', 'Tester', '#58c4ff', 0), claim(1, 1, 'other', 'Someone', '#ff5f5f', 10)]);
  state.setStats(baseStats());

  const map = new TileMap();
  for (let cy = 0; cy < 2; cy++) for (let cx = 0; cx < 2; cx++) map.setChunk(cx, cy, syntheticChunk(cx, cy));
  assert(map.get(20, 10) !== undefined && (map.get(20, 10)! & LOMASK) === ROADS, 'map.get road');
  assert(map.get(5000, 5) === undefined, 'unloaded chunk is undefined');
  map.applyTiles([21, 10, ROADS | BULLBIT, 0, 0, RIVER]);
  assert((map.get(21, 10)! & LOMASK) === ROADS, 'applyTiles');
  assert(map.dirty.has('0,0'), 'dirty tracked');

  const canvas = document.createElement('canvas');
  const r = new Renderer(canvas, sheet, minimap, map, state, { animated: false });
  r.setSize(800, 600, 1);
  // tile mode over the 2x2 area
  r.setCamera(CHUNK, CHUNK, 1);
  assert(r.isTileMode(), 'tile mode at zoom 1');
  r.setHover({ x: 31, y: 31 });
  state.setTool('residential');
  r.render();
  r.render(); // second pass builds any budget-deferred chunk canvases
  assert(r.chunkCanvasCount === 4, `4 chunk canvases, got ${r.chunkCanvasCount}`);
  const g = canvas.getContext('2d')!;
  const px = g.getImageData(400, 300, 1, 1).data;
  assert(px[3] === 255 && px[0] + px[1] + px[2] > 0, 'centre pixel drawn');
  const sub = r.desiredSubscription();
  assert(sub.length > 0 && sub.length <= 80 && sub.some(([x, y]) => x === 0 && y === 0), 'subscription covers viewport');

  // dirty redraw path: change a tile and re-render
  map.applyTiles([22, 10, ROADS | BULLBIT]);
  r.render();
  assert(map.dirty.size === 0, 'dirty consumed');

  // ---- tile animation: nothing animated -> no work; fire tiles -> frames advance through ANI_TILE ----
  assert(!r.animVisible && !r.animTimerPending, 'no animation visible / no timer initially');
  const step0 = r.animStep;
  r.stepAnim();
  assert(r.animStep === step0, 'stepAnim is a no-op without visible animation');
  map.applyTiles([10, 10, FIRE | BURNBIT, 11, 10, (FIRE + 3) | BURNBIT, 12, 10, (FIRE + 7) | BURNBIT]); // old server: no ANIMBIT
  r.render();
  assert(r.animVisible, 'fire visible after placing fire tiles (animated id without ANIMBIT still animates)');
  assert(r.animCount(0, 0) === 3, `3 animated tiles tracked, got ${r.animCount(0, 0)}`);
  const cc = r.chunkCanvasFor(0, 0);
  assert(cc, 'chunk canvas 0,0 exists');
  const cg = cc!.getContext('2d')!;
  const res = cc!.width / CHUNK; // chunk canvases may be drawn at half the sprite size when zoomed out
  const firePx = (x: number, y: number) => [...cg.getImageData(x * res + Math.floor(res / 3), y * res + Math.floor(res / 3), 1, 1).data].join(',');
  const before = [firePx(10, 10), firePx(11, 10), firePx(12, 10)];
  assert(r.frameAt(12, 10) === LASTFIRE, `frame for FIRE+7 before stepping is LASTFIRE, got ${r.frameAt(12, 10)}`);
  r.stepAnim();
  assert(r.animStep === step0 + 1, 'animStep advanced');
  assert(r.frameAt(12, 10) === FIRE && r.frameAt(10, 10) === FIRE + 1 && r.frameAt(11, 10) === FIRE + 4, 'fire frames advance 56->57, 59->60 and wrap 63->56');
  const after = [firePx(10, 10), firePx(11, 10), firePx(12, 10)];
  assert(
    before.every((p, i) => p !== after[i]),
    `fire tiles redrawn with a new frame (${before.join(' | ')} -> ${after.join(' | ')})`,
  );
  // the whole fire cycle is 56->57->...->63->56
  for (let i = 0, id = FIRE; i < 8; i++, id = ANI_TILE[id]) assert(ANI_TILE[id] === (id === LASTFIRE ? FIRE : id + 1), `fire cycle at ${id}`);
  // extinguish: tile leaves the animated set
  map.applyTiles([10, 10, DIRT, 11, 10, DIRT, 12, 10, DIRT]);
  r.render();
  assert(!r.animVisible && r.animCount(0, 0) === 0, 'animation gone after tiles change back');

  // ---- general animation: coal smoke, light traffic and a fountain flagged with ANIMBIT ----
  const smoke = COALSMOKE1 | ANIMBIT | PWRBIT,
    road = LTRFBASE | ANIMBIT | BULLBIT,
    fountain = FOUNTAIN | ANIMBIT;
  map.applyTiles([5, 20, smoke, 6, 20, road, 7, 20, fountain, 8, 20, ROADS | BULLBIT]);
  r.render();
  assert(r.animCount(0, 0) === 3, `3 ANIMBIT tiles tracked, got ${r.animCount(0, 0)}`);
  const stillBefore = firePx(8, 20);
  const expect2 = (id: number) => ANI_TILE[ANI_TILE[id]];
  r.stepAnim();
  r.stepAnim();
  assert(
    r.frameAt(5, 20) === expect2(COALSMOKE1) && r.frameAt(5, 20) === COALSMOKE1 + 2,
    `coal smoke after 2 steps = ANI_TILE[ANI_TILE[916]] (${r.frameAt(5, 20)})`,
  );
  assert(
    r.frameAt(6, 20) === expect2(LTRFBASE) && r.frameAt(6, 20) === 112,
    `light traffic after 2 steps = ANI_TILE[ANI_TILE[80]] = 112 (80->128->112), got ${r.frameAt(6, 20)}`,
  );
  assert(r.frameAt(7, 20) === expect2(FOUNTAIN) && r.frameAt(7, 20) === FOUNTAIN + 2, `fountain after 2 steps (${r.frameAt(7, 20)})`);
  assert(r.frameAt(8, 20) === ROADS && firePx(8, 20) === stillBefore, 'non-animated road untouched');
  // tiles update: the stored value changes -> frame resets to the new id and membership is re-evaluated
  map.applyTiles([5, 20, DIRT, 6, 20, (HTRFBASE + 1) | ANIMBIT | BULLBIT]);
  r.render();
  assert(r.animCount(0, 0) === 2 && r.frameAt(6, 20) === HTRFBASE + 1 && r.frameAt(5, 20) === DIRT, 'changed tiles reset their frame / leave the set');
  r.stepAnim();
  assert(r.frameAt(6, 20) === ANI_TILE[HTRFBASE + 1] && r.frameAt(6, 20) === 193, `heavy traffic steps 145->193, got ${r.frameAt(6, 20)}`);
  map.applyTiles([6, 20, DIRT, 7, 20, DIRT]);
  r.render();
  assert(!r.animVisible && !r.animTimerPending, 'no animation / no timer once nothing animated is visible');
  // an animated chunk that scrolls off screen stops animating (no timer scheduled by the next render)
  map.applyTiles([7, 20, fountain]);
  r.setCamera(CHUNK * 20, CHUNK * 20, 1); // far away, nothing loaded there
  r.render();
  assert(!r.animVisible, 'off-screen animated tiles are not stepped');
  r.setCamera(CHUNK, CHUNK, 1);
  r.render();
  assert(r.animVisible, 'back on screen: animated again');
  map.applyTiles([7, 20, DIRT]);
  r.render();

  // ---- sprite engine: a train on a synthetic rail loop moves between two frames ----
  {
    const eng = new SpriteEngine(map, { image: null, defs: {} }, () => 0.5);
    // rail loop in chunk 0,0 inside the viewport (tiles 39..89 x 45..83): rectangle x 50..57, y 50..55 (corner pieces + straights)
    const LX0 = 50,
      LX1 = 57,
      LY0 = 50,
      LY1 = 55;
    const loop: number[] = [];
    for (let x = LX0; x <= LX1; x++) {
      loop.push(x, LY0, (x === LX0 ? LVRAIL3 : x === LX1 ? LVRAIL4 : LHRAIL) | BULLBIT, x, LY1, (x === LX0 ? LVRAIL2 : x === LX1 ? LVRAIL5 : LHRAIL) | BULLBIT);
    }
    for (let y = LY0 + 1; y < LY1; y++) loop.push(LX0, y, LVRAIL | BULLBIT, LX1, y, LVRAIL | BULLBIT);
    map.applyTiles(loop);
    r.render();
    const view = (): SpriteView => ({ ...r.viewRect(), ...r.visibleChunkRect(0) });
    eng.rescan(view(), 0);
    assert(eng.scan.rails.length === 24 * 2, `rail scan found the loop (${eng.scan.rails.length / 2} tiles)`);
    const trains = eng.sprites.filter((p) => p.kind === 'train');
    assert(trains.length === 1, `one train on a small loop, got ${trains.length}`);
    assert(
      eng.sprites.every((p) => p.kind === 'train'),
      'no ship / plane without seaport / airport',
    );
    const t = trains[0];
    const x0 = t.x,
      y0 = t.y;
    eng.frame(1000, view()); // first frame: dt 0
    eng.frame(1100, view()); // 100 ms at 4 tiles/s -> 0.4 tiles
    const moved = Math.hypot(t.x - x0, t.y - y0); // 0.4 tiles of track, a bit less when it rounded a corner
    assert(moved > 0.28 && moved < 0.401, `train moved 0.4 tiles between two frames 100 ms apart (${x0},${y0} -> ${t.x},${t.y})`);
    eng.frame(2100, view()); // a long gap (tab was hidden) is clamped so nothing teleports
    assert(Math.hypot(t.x - x0, t.y - y0) < 0.81, 'frame delta clamped after a pause');
    assert(t.frame === (t.dx === 0 ? 0 : 1), 'train uses the vertical frame for N/S and horizontal for E/W');
    // it keeps circling the loop and never leaves the rail
    for (let i = 0; i < 200; i++) {
      eng.step(0.05, view());
      const tx = Math.floor(t.x),
        ty = Math.floor(t.y);
      assert(
        tx >= LX0 && tx <= LX1 && ty >= LY0 && ty <= LY1 && (tx === LX0 || tx === LX1 || ty === LY0 || ty === LY1),
        `train stays on the loop (${t.x},${t.y})`,
      );
    }
    assert(eng.sprites.includes(t), 'train still alive after circling');
    // remove the rail: the train despawns on the next scan
    const clear: number[] = [];
    for (let i = 0; i < loop.length; i += 3) clear.push(loop[i], loop[i + 1], DIRT);
    map.applyTiles(clear);
    eng.rescan(view(), 5000);
    assert(eng.sprites.length === 0 && !eng.active, 'train despawned when the rail is gone; engine inactive');
    // draws without throwing in fallback mode and through the renderer hook
    r.sprites = eng;
    map.applyTiles(loop);
    r.render();
    assert(eng.sprites.length === 1, 'renderer hook scans + spawns');
    map.applyTiles(clear);
    r.render();
    r.sprites = null;
  }

  // ---- flash marker ----
  r.flashTile(10, 10, 1000);
  assert(r.flashActive, 'flash active');
  r.render(1500);
  assert(r.flashActive, 'flash still active at 0.5s');
  r.render(3500);
  assert(!r.flashActive, 'flash expired after 2s');

  // ---- DOM UI driven by synthetic server messages ----
  const net = new Net('ws://127.0.0.1:1/never'); // never connected; sends are dropped
  const actions = new Actions(state, net, r);
  const ui = new UI(state, net, r, actions, sheet, minimap);
  const targets: DispatchTargets = { state, map, renderer: r, ui };
  net.on('msg', (m) => handleServerMsg(m, targets));
  const q = <T extends Element>(sel: string): T | null => document.querySelector<T>(sel);
  const qa = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];

  // leaderboard
  ui.openLeaderboard();
  assert(ui.isLeaderboardOpen(), 'leaderboard panel open');
  assert(q('#world .lb-empty'), 'empty state before data');
  net.emit('msg', { t: 'leaderboard', entries: DEMO_LEADERBOARD, me: { rank: 3, population: 64_210 } });
  const rows = qa('#world .lb-row');
  assert(rows.length === DEMO_LEADERBOARD.length, `leaderboard renders ${DEMO_LEADERBOARD.length} rows, got ${rows.length}`);
  assert(
    rows.every((row) => row.querySelector('button.visit')),
    'every row has a Visit button',
  );
  assert(rows[2].classList.contains('me') && rows[2].textContent!.includes('Tester (you)'), 'own row highlighted');
  assert(rows[1].textContent!.includes('🔥 3') && !rows[0].textContent!.includes('🔥'), 'fire count shown only when > 0');
  assert(rows[0].textContent!.includes('184,320'), 'population formatted');
  assert(q('#world .lb-me')!.textContent!.startsWith('Your rank: #3'), 'own rank shown');
  net.emit('msg', { t: 'leaderboard', entries: DEMO_LEADERBOARD.slice(0, 2) });
  assert(qa('#world .lb-row').length === 2, 'panel updates on new leaderboard message');
  assert(q('#world .lb-me')!.textContent!.startsWith('Not ranked yet'), 'unranked text without me');
  // visit flies to the entry's chunk centre at zoom 1
  (qa('#world .lb-row button.visit')[0] as HTMLButtonElement).click();
  assert(!ui.isLeaderboardOpen(), 'visit closes the panel');
  r.render(performance.now() + 10_000); // finish the fly
  const e0 = DEMO_LEADERBOARD[0];
  assert(
    Math.abs(r.cam.x - (e0.cx + 0.5) * CHUNK) < 1 && Math.abs(r.cam.y - (e0.cy + 0.5) * CHUNK) < 1 && r.cam.zoom === 1,
    `visit flew to chunk centre (${r.cam.x},${r.cam.y},${r.cam.zoom})`,
  );
  assert(state.leaderboard.length === 2, 'last list kept in state');

  // power trade + fire stats
  net.emit('msg', { t: 'stats', stats: baseStats({ powerSupply: 10, powerDemand: 15, powerImported: 5, powerTradeNet: -5, fires: 2, fireStations: 1 }) });
  const trade = q<HTMLElement>('#powerTrade')!;
  assert(!trade.classList.contains('hidden'), 'trade line visible');
  assert(trade.textContent === '⬇ buying 5 units (−$5/mo)', `trade text, got "${trade.textContent}"`);
  assert(trade.querySelector('.paying') && !trade.querySelector('.income'), 'paying styled amber');
  assert(trade.title.includes('Power flows over wires'), 'trade tooltip');
  assert(!q('#rci .stations') && !q('#police') && !q('#specials'), 'no station, police or special-building badges in the status panel');
  const fireBtn = q<HTMLButtonElement>('#fireBtn')!;
  assert(!fireBtn.classList.contains('hidden') && fireBtn.textContent === '🔥 2 fires', `fire badge, got "${fireBtn.textContent}"`);
  net.emit('msg', { t: 'stats', stats: baseStats({ powerExported: 7, powerTradeNet: 7, powerImported: 2 }) });
  assert(
    trade.textContent!.includes('⬆ selling 7 units (+$7/mo)') && trade.textContent!.includes('⬇ buying 2 units (−$2/mo)'),
    `both flows, got "${trade.textContent}"`,
  );
  net.emit('msg', { t: 'stats', stats: baseStats() });
  assert(trade.classList.contains('hidden') && fireBtn.classList.contains('hidden'), 'trade line and fire badge hidden when zero');

  // fire badge cycles through burning tiles in own chunks
  map.applyTiles([25, 25, FIRE | BURNBIT, 40, 40, (FIRE + 2) | BURNBIT, 70, 70, FIRE | BURNBIT]); // 70,70 is in chunk 1,1 (not mine)
  const burning = ui.burningTiles();
  assert(burning.length === 2 && burning[0].x === 25 && burning[1].x === 40, `burning tiles in own chunks, got ${JSON.stringify(burning)}`);
  assert(ui.nextFire(), 'nextFire found a fire');
  r.render(performance.now() + 1000); // fly (700 ms) done, flash (2 s) still live
  assert(Math.abs(r.cam.x - 25.5) < 1e-6 && r.cam.zoom === 2 && r.flashActive, `nextFire flew to the first fire (${r.cam.x},${r.cam.zoom})`);
  ui.nextFire();
  r.render(performance.now() + 10_000);
  assert(Math.abs(r.cam.x - 40.5) < 1e-6, 'nextFire cycles to the second fire');
  map.applyTiles([25, 25, DIRT, 40, 40, DIRT, 70, 70, DIRT]);

  // clickable toast with `at`
  net.emit('msg', { t: 'toast', msg: 'Fire at 100, 90!', kind: 'error', at: { x: 100, y: 90 } });
  const toast = q<HTMLElement>('#toasts .toast.clickable')!;
  assert(
    toast && toast.classList.contains('error') && toast.getAttribute('role') === 'button' && toast.textContent === 'Fire at 100, 90!',
    'toast with at is clickable',
  );
  assert(getComputedStyle(toast).pointerEvents === 'auto' && getComputedStyle(toast).cursor === 'pointer', 'clickable toast accepts clicks');
  // dedup: same message again refreshes rather than stacking
  net.emit('msg', { t: 'toast', msg: 'Fire at 100, 90!', kind: 'error', at: { x: 100, y: 90 } });
  assert(qa('#toasts .toast').length === 1, 'identical toast within 3s deduped');
  net.emit('msg', { t: 'toast', msg: 'Something else', kind: 'info' });
  assert(qa('#toasts .toast').length === 2 && !qa('#toasts .toast')[1].classList.contains('clickable'), 'different toast stacks; without at not clickable');
  toast.click();
  r.render(performance.now() + 1000);
  assert(
    Math.abs(r.cam.x - 100.5) < 1e-6 && Math.abs(r.cam.y - 90.5) < 1e-6 && r.cam.zoom === 2,
    `toast click flew to tile at zoom 2 (${r.cam.x},${r.cam.y},${r.cam.zoom})`,
  );
  assert(r.flashActive, 'toast click flashes the marker');

  // ---- city names + abandonment on claims ----
  r.setCamera(CHUNK, CHUNK, 1); // 2x2 area again, all four chunk corners visible
  assert(state.cityName === '', 'no city name before any named claim');
  net.emit('msg', {
    t: 'claims',
    claims: [
      claim(0, 0, 'me', 'Tester', '#58c4ff', 5, { cityName: 'Testville' }),
      claim(1, 1, 'other', 'Someone', '#ff5f5f', 10, { cityName: 'Oldtown', idleDays: ABANDON_IDLE_DAYS + 11 }),
      claim(1, 0, 'p3', 'Idler', '#ffb347', 3, { cityName: 'Napville', idleDays: 12 }),
      { cx: 0, cy: 1, ownerId: 'p4', ownerName: 'Legacy', color: '#7ddc5c', pop: 1 } as ClaimInfo, // old server: no cityName / idleDays
    ],
  });
  assert(state.cityName === 'Testville', `me.cityName follows my claim, got "${state.cityName}"`);
  const cityBtn = q<HTMLButtonElement>('#cityNameBtn')!;
  assert(!cityBtn.classList.contains('hidden') && cityBtn.textContent!.includes('Testville'), `city name in the top bar, got "${cityBtn.textContent}"`);
  assert(q('#plots')!.textContent === `Plots1/${MAX_CHUNKS_PER_PLAYER}`, `plots counter, got "${q('#plots')!.textContent}"`);
  r.render();
  const lab = (cx: number, cy: number) => r.drawnClaims.get(`${cx},${cy}`);
  assert(lab(0, 0)?.label === 'Testville — Tester (you)' && !lab(0, 0)!.abandoned, `own label, got "${lab(0, 0)?.label}"`);
  assert(
    lab(1, 1)?.label === `Oldtown — Someone (abandoned, up for grabs in ${ABANDON_FREE_DAYS - ABANDON_IDLE_DAYS - 11} days)` &&
      lab(1, 1)!.abandoned &&
      lab(1, 1)!.idle === 'abandoned',
    `abandoned label + grey flag, got "${lab(1, 1)?.label}" ${lab(1, 1)?.abandoned}`,
  );
  assert(lab(1, 1)!.color !== '#ff5f5f', 'abandoned claim colour is desaturated');
  assert(lab(1, 0)?.label === 'Napville — Idler · idle 12d' && lab(1, 0)!.idle === 'idle' && !lab(1, 0)!.abandoned, `idle label, got "${lab(1, 0)?.label}"`);
  assert(lab(0, 1)?.label === 'Legacy' && lab(0, 1)!.idle === 'active', `old-server claim tolerated, got "${lab(0, 1)?.label}"`);
  assert(claimLabel(claim(5, 5, 'x', 'Solo', '#fff', 0), false) === 'Solo', 'label without city is just the mayor');
  // query popover shows the city before the mayor
  ui.showQuery({ x: 70, y: 70, tile: 0, name: 'Dirt', powered: false, owner: { id: 'other', name: 'Someone', color: '#ff5f5f', cityName: 'Oldtown' } });
  assert(q('#query')!.textContent!.includes('Owner: Oldtown — Someone'), 'query popover shows city — mayor');
  ui.hideQuery();
  // leaderboard rows: city bold, mayor beneath
  ui.openLeaderboard();
  net.emit('msg', { t: 'leaderboard', entries: DEMO_LEADERBOARD });
  const lbRows = qa('#world .lb-row');
  assert(
    lbRows[0].querySelector('.name .city')!.textContent === 'Kyoto' && lbRows[0].querySelector('.name .mayor')!.textContent === 'Hanzo',
    'leaderboard row shows city then mayor',
  );
  assert(
    lbRows[6].querySelector('.name .city')!.textContent === 'Ada' && !lbRows[6].querySelector('.name .mayor'),
    'row without a city name shows the mayor bold',
  );
  assert(lbRows[2].querySelector('.name .mayor')!.textContent === 'Tester (you)', 'own row marks the mayor');
  ui.toggleLeaderboard();
  // rename city goes out as renameCity (net is offline: send returns false, but the local name updates)
  const sent: string[] = [];
  const origSend = net.send.bind(net);
  net.send = (m) => {
    sent.push(JSON.stringify(m));
    return origSend(m);
  };
  actions.renameCity('  New Testville ');
  assert(state.cityName === 'New Testville' && sent.some((m) => m === '{"t":"renameCity","name":"New Testville"}'), 'renameCity sent + applied locally');
  assert(cityBtn.textContent!.includes('New Testville'), 'top bar follows the rename');

  // unclaim: the chunk becomes plain unclaimed land (claimable when adjacent to mine)
  assert(!state.canClaim(1, 0), 'claimed chunk is not claimable');
  net.emit('msg', { t: 'unclaim', cx: 1, cy: 0 });
  assert(!state.claimAt(1, 0), 'unclaim removed the claim');
  assert(state.canClaim(1, 0), 'released plots are claimable (adjacent to mine)');
  r.render();
  assert(!lab(1, 0), 'no label drawn for the released chunk');
  net.emit('msg', { t: 'unclaim', cx: 0, cy: 0 }); // mine
  assert(state.ownedChunkCount() === 0 && q('#plots')!.textContent === `Plots0/${MAX_CHUNKS_PER_PLAYER}`, 'own chunk list updated after unclaim');
  assert(
    qa('#toasts .toast').some((t) => t.textContent!.includes('released after inactivity')),
    'unclaim of my plot toasts',
  );
  // founding toast: first claim after having none, with the city name riding on the claim
  net.emit('msg', { t: 'claim', claim: claim(0, 0, 'me', 'Tester', '#58c4ff', 0, { cityName: 'Newtown' }) });
  assert(
    qa('#toasts .toast').some((t) => t.textContent!.startsWith('You founded Newtown!')),
    'founding toast with city name',
  );
  // claim cap: with MAX plots, canClaim is false and the button hides
  const cap: ClaimInfo[] = [];
  for (let i = 0; i < MAX_CHUNKS_PER_PLAYER; i++) cap.push(claim(10 + i, 10, 'me', 'Tester', '#58c4ff', 0, { cityName: 'Newtown' }));
  net.emit('msg', { t: 'claims', claims: cap });
  assert(state.atClaimCap() && !state.canClaim(10, 11), 'canClaim false at the plot cap');
  r.setCamera(10 * CHUNK + 32, 11 * CHUNK + 32, 1);
  r.render();
  r.emit('settle', r.cam);
  assert(
    q('#claimBtn')!.classList.contains('hidden') && q('#plots')!.classList.contains('hidden') === false && q('#plots .val')!.classList.contains('bad'),
    'claim button hidden at cap, counter red',
  );
  for (const c of cap) net.emit('msg', { t: 'unclaim', cx: c.cx, cy: c.cy });
  net.emit('msg', { t: 'unclaim', cx: 0, cy: 0 });
  net.emit('msg', {
    t: 'claims',
    claims: [claim(0, 0, 'me', 'Tester', '#58c4ff', 0, { cityName: 'Testville' }), claim(1, 1, 'other', 'Someone', '#ff5f5f', 10)],
  });

  // ---- neighbour / rail indicators ----
  net.emit('msg', {
    t: 'stats',
    stats: baseStats({ demand: { r: 0.5, c: 0.6, i: 0.1 }, neighbours: 2, railLinks: 1, neighbourDemand: { r: 0, c: 0.2, i: 0 }, railDemand: 0.1 }),
  });
  const nb = q<HTMLElement>('#neighbours')!;
  assert(!nb.classList.contains('hidden') && nb.textContent === '🤝 2 neighbours · 🚆 1 rail link', `neighbour line, got "${nb.textContent}"`);
  assert(nb.title === NEIGHBOUR_HELP, 'neighbour tooltip');
  const fillC = q<HTMLElement>('#rci .bar.c .fill')!;
  assert(
    fillC.style.height === '30%' && fillC.style.top === '20%',
    `C bar = total demand 0.6 -> 30% from the middle up, got h=${fillC.style.height} top=${fillC.style.top}`,
  );
  const boostC = q<HTMLElement>('#rci .bar.c .boost')!,
    boostR = q<HTMLElement>('#rci .bar.r .boost')!;
  assert(
    !boostC.classList.contains('hidden') && Math.abs(parseFloat(boostC.style.height) - 15) < 0.01 && boostC.style.top === '20%',
    `C boost overlay (0.2+0.1)*50% at the tip, got h=${boostC.style.height} top=${boostC.style.top}`,
  );
  assert(boostR.classList.contains('hidden'), 'no boost overlay without neighbour demand');
  net.emit('msg', { t: 'stats', stats: baseStats() });
  assert(nb.classList.contains('hidden') && boostC.classList.contains('hidden'), 'neighbour line + overlay hidden when zero');
  net.emit('msg', {
    t: 'stats',
    stats: { ...baseStats(), neighbours: undefined, neighbourDemand: undefined, railLinks: undefined, railDemand: undefined } as unknown as PlayerStats,
  });
  assert(nb.classList.contains('hidden'), 'old server stats without neighbour fields tolerated');

  // ---- traffic / crime stats ----
  net.emit('msg', { t: 'stats', stats: baseStats({ traffic: 0.3, crime: 0.6, policeStations: 0, fireStations: 1 }) });
  const trafficEl = q<HTMLElement>('#traffic')!,
    crimeEl = q<HTMLElement>('#crime')!;
  assert(!trafficEl.classList.contains('hidden') && trafficEl.textContent === '🚗 moderate traffic', `traffic line, got "${trafficEl.textContent}"`);
  assert(q<HTMLElement>('#traffic .fill')!.style.width === '30%', 'traffic meter width');
  assert(!crimeEl.classList.contains('hidden') && crimeEl.textContent === '⚠ crime' && crimeEl.classList.contains('bad'), 'crime warning shown in red');
  net.emit('msg', { t: 'stats', stats: baseStats({ traffic: 0.1, crime: 0.6, policeStations: 2, specials: { stadium: 1, seaport: 0, airport: 1 } }) });
  assert(trafficEl.textContent === '🚗 light traffic' && crimeEl.classList.contains('hidden'), 'light traffic, police present hides the crime warning');
  assert(!q('#specials') && !q('#rci .chip'), 'no special-building badges');
  net.emit('msg', { t: 'stats', stats: baseStats({ traffic: 0.7 }) });
  assert(trafficEl.textContent === '🚗 heavy traffic', 'heavy traffic');
  net.emit('msg', { t: 'stats', stats: baseStats() });
  assert(trafficEl.classList.contains('hidden'), 'traffic hidden at zero');
  net.emit('msg', {
    t: 'stats',
    stats: { ...baseStats(), crime: undefined, policeStations: undefined, specials: undefined, traffic: undefined } as unknown as PlayerStats,
  });
  assert(trafficEl.classList.contains('hidden') && crimeEl.classList.contains('hidden'), 'old server stats without the new fields tolerated');

  // ---- presence markers ----
  r.setCamera(CHUNK, CHUNK, 1); // view covers roughly tiles 39..89 x 45..83
  const t0 = performance.now();
  const frame = (players: Presence[], now: number) => {
    state.setPresence(players, now);
    r.render(now);
  };
  frame(
    [
      { id: 'a', name: 'Lena', cityName: 'Eindhoven', color: '#4dd0e1', x: 60, y: 60, zoom: 1, cx: 50, cy: 50 },
      { id: 'b', name: 'Hanzo', cityName: '', color: '#ff5f5f', x: 70, y: 70, zoom: 2 }, // camera only
      { id: 'c', name: 'Far', cityName: 'Away', color: '#7ddc5c', x: 5000, y: 3000, zoom: 1, cx: 5000, cy: 3000 },
    ],
    t0,
  );
  let dp = r.drawnPresence;
  assert(dp.length === 2, `two presences on screen, got ${dp.length}`);
  const pa = dp.find((d) => d.id === 'a')!,
    pb = dp.find((d) => d.id === 'b')!;
  assert(pa && pa.kind === 'cursor' && pa.label === 'Lena · Eindhoven', `cursor marker with chip, got ${JSON.stringify(pa)}`);
  assert(pb && pb.kind === 'dot' && pb.label === 'Hanzo', `camera-only presence drawn as a dot, got ${JSON.stringify(pb)}`);
  // marker pixels: the cursor tile (50,50) is at screen (400+(50-64)*16, 300+(50-64)*16) = (176, 76); its outline is cyan-ish
  const cur = g.getImageData(191, 84, 1, 1).data; // right edge of the 16px cursor outline, clear of the pointer arrow
  assert(cur[2] > 150 && cur[1] > 150, `cursor marker pixel drawn in player colour, got ${[...cur].join(',')}`);
  // interpolation: the next frame moves the cursor by 10 tiles; halfway through the lerp it is in between
  frame([{ id: 'a', name: 'Lena', cityName: 'Eindhoven', color: '#4dd0e1', x: 60, y: 60, zoom: 1, cx: 60, cy: 50 }], t0 + 500);
  const x0 = r.drawnPresence[0].x;
  assert(x0 === 176, `lerp starts at the old position (${x0})`);
  r.render(t0 + 600);
  const xMid = r.drawnPresence[0].x;
  assert(xMid > 176 && xMid < 336, `lerp midway (${xMid})`);
  r.render(t0 + 900);
  assert(r.drawnPresence[0].x === 336, `lerp finished at the new position (${r.drawnPresence[0].x})`);
  assert(r.drawnPresence.length === 1, 'players missing from the new frame are dropped');
  // stale frame: nothing drawn after 3 s without frames
  r.render(t0 + 900 + 3100);
  assert(r.drawnPresence.length === 0, 'stale presence frame not drawn');
  // overview: viewport rectangles with chips
  r.showWorld();
  frame([{ id: 'a', name: 'Lena', cityName: 'Eindhoven', color: '#4dd0e1', x: 2000, y: 1500, zoom: 1, cx: 2000, cy: 1500 }], t0 + 5000);
  assert(
    r.drawnPresence.length === 1 && r.drawnPresence[0].kind === 'dot' && r.drawnPresence[0].label === 'Lena · Eindhoven',
    'overview draws a dot with chip',
  );

  // ---- 'view' throttle: rapid camera moves send at most 4/s ----
  let clock = 0;
  const views: string[] = [];
  const spyNet = new Net('ws://127.0.0.1:1/never');
  spyNet.send = (m) => {
    if (m.t === 'view') views.push(JSON.stringify(m));
    return false;
  };
  const reporter = new ViewReporter(spyNet, r, () => clock);
  r.setCamera(CHUNK, CHUNK, 1);
  r.setHover({ x: 50, y: 50 });
  for (let i = 0; i <= 105; i++) {
    clock = i * 10;
    r.setCamera(CHUNK + i, CHUNK, 1);
    reporter.poke();
  } // 106 moves in 1.05 s
  const perSec = 1000 / VIEW_INTERVAL_MS; // 4
  assert(views.length === perSec + 1, `view throttled: sends at 0, 250, 500, 750, 1000 ms -> ${perSec + 1}, got ${views.length}`);
  const v0 = JSON.parse(views[0]);
  assert(v0.t === 'view' && v0.zoom === 1 && v0.cx === 50 && v0.cy === 50 && Number.isFinite(v0.x), `view payload has camera + cursor, got ${views[0]}`);
  assert(JSON.parse(views[views.length - 1]).x === CHUNK + 100, 'moves inside the window are held back');
  await new Promise((res) => setTimeout(res, VIEW_INTERVAL_MS + 50)); // the trailing send fires (real timer)
  assert(
    views.length === perSec + 2 && JSON.parse(views[views.length - 1]).x === CHUNK + 105,
    `trailing send carries the latest camera (${views[views.length - 1]})`,
  );
  // phones: no hover, the last touched tile is the cursor others see
  r.setHover(null);
  r.setTouchCursor({ x: 70, y: 71 });
  clock += 1000;
  reporter.poke();
  assert(
    JSON.parse(views[views.length - 1]).cx === 70 && JSON.parse(views[views.length - 1]).cy === 71,
    `touch cursor sent as the cursor (${views[views.length - 1]})`,
  );
  r.setHover({ x: 50, y: 50 });
  clock += 1000;
  reporter.poke();
  assert(JSON.parse(views[views.length - 1]).cx === 50, 'a hovered tile wins over the touch cursor');
  r.setTouchCursor(null);
  r.showWorld();
  clock += 1000;
  reporter.poke();
  assert(JSON.parse(views[views.length - 1]).cx === undefined, 'no cursor in the view message outside tile mode');
  net.send = origSend;

  // overview
  r.showWorld();
  assert(!r.isTileMode(), 'overview mode at fit zoom');
  r.render();
  const px2 = g.getImageData(400, 300, 1, 1).data;
  assert(px2[3] === 255, 'overview drawn');
  assert(r.desiredSubscription().length === 0, 'no subscription in overview');
  // the overview is cached while panning; a new plot still shows on the next frame
  r.render();
  r.panBy(3, 2);
  r.render();
  assert(!r.drawnClaims.has('40,20'), 'plot 40,20 not drawn before it is claimed');
  state.setClaim(claim(40, 20, 'p9', 'Newcomer', '#e040fb', 1));
  r.panBy(-3, -2);
  r.render();
  assert(r.drawnClaims.has('40,20'), 'a new plot shows on the cached overview');
  state.removeClaim(40, 20);
  r.render();
  assert(!r.drawnClaims.has('40,20'), 'a released plot leaves the cached overview');

  // zoom stepping reaches tile mode and back
  for (let i = 0; i < r.zoomLevels().length; i++) r.zoomStep(1);
  assert(r.cam.zoom >= 0.5, `zoom steps up (${r.cam.zoom})`);

  console.log('selftest ok');
  document.body.insertAdjacentHTML(
    'beforeend',
    '<pre id="selftest" style="color:#7ddc5c;font:14px monospace;padding:16px;position:fixed;left:0;top:40px;z-index:9">selftest ok</pre>',
  );
}
