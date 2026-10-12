// Canvas 2D renderer: tile mode (chunk canvases blitted from the sprite sheet) and
// overview mode (minimap + claim rectangles). Redraws only when invalidated.
import {
  CHUNK, CHUNKS_X, CHUNKS_Y, WORLD_W, WORLD_H, TILE_PX, MAX_SUBSCRIBED_CHUNKS,
  LOMASK, ZONEBIT, PWRBIT, ANIMBIT, LIGHTNINGBOLT, FIRE, LASTFIRE, TOOLS, CUSTOM_BUILDINGS, footprintOrigin, toolW, toolH, chunkKey, parseChunkKey, clamp, inWorld,
} from '@globalcity/shared';
import type { ClaimInfo, Flight, Voyage } from '@globalcity/shared';
import type { SpriteSheet, Minimap } from './assets.ts';
import { drawTile } from './assets.ts';
import { ANI_TILE, isAnimatedId } from './anim.ts';
import { TileMap, DIRTY_ALL } from './map.ts';
import type { AppState, ClaimIdle } from './state.ts';
import { claimIdleState, claimLabel, claimShortLabel } from './state.ts';
import { Emitter } from './emitter.ts';
import { PresenceTracker, presenceLabel, PRESENCE_STALE_MS } from './presence.ts';
import type { SpriteEngine } from './sprites.ts';
import { FlightLayer, ShipLayer } from './flights.ts';
import { OverlayLayer } from './overlays.ts';
import { CustomLayer } from './custom.ts';
import { NightLayer, NIGHT_REFRESH_MS } from './night.ts';
import { NightLights, type NightImage } from './nightlights.ts';

/** How much of the night shade the zoomed-in city gets: dim, never dark, so building stays easy at night. */
const NIGHT_CITY_DIM = 0.8;
import { OverviewMap, speckleTile } from './overviewmap.ts';
import { WORLD_W as FLIGHT_WORLD_W } from '@globalcity/shared';

export interface Camera { x: number; y: number; zoom: number }
export interface TilePos { x: number; y: number }
export interface ChunkRect { cx0: number; cy0: number; cx1: number; cy1: number }

export const TILE_MODE_ZOOM = 0.5;
export const MAX_ZOOM = 3;
const CHUNK_PX = CHUNK * TILE_PX; // 1024
const MAX_CHUNK_CANVASES = 120;
const CHUNK_BUILD_BUDGET = 8; // chunk canvases built per frame
const SETTLE_MS = 150;
/** Tile animation cadence (Micropolis animates at ~5 fps). */
export const ANIM_MS = 200;
const FLASH_MS = 2000;

type RendererEvents = { camera: Camera; settle: Camera; hover: TilePos | null };

/** `anim`: tile indices in this chunk that animate (ANIMBIT set, or an animated id for old servers);
 *  `frame`: the tile id currently drawn for each of them (advanced through ANI_TILE every ANIM_MS while on screen). */
interface ChunkCanvas { key: string; canvas: HTMLCanvasElement; g: CanvasRenderingContext2D; lastUse: number; anim: Set<number>; frame: Map<number, number> }

export function isFireTile(v: number): boolean { const id = v & LOMASK; return id >= FIRE && id <= LASTFIRE; }
/** True when the tile value animates: the server flags animated tiles with ANIMBIT; old servers do not, so animated ids count too. */
/**
 * Ids that sit in a closed animation loop (fire, smoke, traffic, radar, ...). ANI_TILE also holds
 * one-way "still -> animated" switches (e.g. coal plant 747 -> smoke 916, nuclear 820 -> swirl 952)
 * that the server applies only while a building is powered, so those must NOT animate on their own.
 */
const LOOPING = (() => {
  const set = new Set<number>();
  for (let id = 0; id < ANI_TILE.length; id++) {
    if (!isAnimatedId(id)) continue;
    let cur = id;
    for (let k = 0; k < 32; k++) { cur = ANI_TILE[cur]; if (cur === id) { set.add(id); break; } }
  }
  return set;
})();
/** Animate when the server flagged it (ANIMBIT), or, for old servers, when the id is in a closed loop. */
export function isAnimatedTile(v: number): boolean { return (v & ANIMBIT) !== 0 || LOOPING.has(v & LOMASK); }

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function withAlpha(hex: string, a: number): string {
  const c = parseHex(hex);
  return c ? `rgba(${c[0]},${c[1]},${c[2]},${a})` : `rgba(255,255,255,${a})`;
}

/** Mostly-grey version of a player colour, for abandoned plots. */
export function desaturate(hex: string, keep = 0.25): string {
  const c = parseHex(hex) ?? [200, 200, 200];
  const l = Math.round(0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]);
  const mix = (v: number) => Math.round(l + (v - l) * keep);
  return `#${[mix(c[0]), mix(c[1]), mix(c[2])].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** How a claim is drawn: its (possibly greyed) colour, the label, and whether it is abandoned. */
export interface ClaimStyle { color: string; label: string; idle: ClaimIdle; abandoned: boolean }
export function claimStyle(c: ClaimInfo, own: boolean): ClaimStyle {
  const idle = claimIdleState(c);
  const abandoned = idle === 'abandoned';
  return { color: abandoned ? desaturate(c.color) : c.color, label: claimLabel(c, own), idle, abandoned };
}

/** Test hook record of a presence marker drawn in the last frame. */
export interface DrawnPresence { id: string; kind: 'cursor' | 'dot'; x: number; y: number; label: string }

export class Renderer extends Emitter<RendererEvents> {
  readonly ctx: CanvasRenderingContext2D;
  cam: Camera = { x: WORLD_W / 2, y: WORLD_H / 2, zoom: 0.03 };
  hover: TilePos | null = null;
  cssW = 1; cssH = 1; dpr = 1;
  /** chunks currently subscribed (for the pending-vs-unsubscribed checker shade) */
  subscribed = new Set<string>();
  /** css px covered by fixed UI along the left / top edges (toolbar, top bar); chunk labels are kept out from under them */
  overlayInset = { left: 0, top: 0 };
  private chunkCanvases = new Map<string, ChunkCanvas>();
  private frame = 0;
  private scheduled = false;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private checker: CanvasPattern | null = null;
  private fly: { from: Camera; to: Camera; t0: number; ms: number } | null = null;
  private pendingBuilds = 0;
  readonly animated: boolean;
  /** tile animation: steps taken so far, chunk canvases with animated tiles blitted in the last frame, pending timer */
  animStep = 0;
  private visibleAnim: ChunkCanvas[] = [];
  private animTimer: ReturnType<typeof setTimeout> | null = null;
  /** cosmetic sprites (trains, ship, plane, helicopter) drawn over the tiles in tile mode; null = none */
  sprites: SpriteEngine | null = null;
  /** inter-city air traffic (airports published by the server) */
  readonly flightLayer = new FlightLayer();
  /** ships between seaports */
  readonly shipLayer = new ShipLayer();
  /** map overlays (power, fire, crime, traffic, land value), zoomed-in view only */
  overlay!: OverlayLayer;
  /** custom-building layer: non-square buildings drawn as one image */
  readonly customs = new CustomLayer();
  /** pending redraw for the next frame of an animated custom building on screen */
  private customAnimTimer: ReturnType<typeof setTimeout> | null = null;
  /** zoomed-out map view: per-plot pixel images + tile-coloured terrain with specks */
  readonly overviewMap = new OverviewMap();
  /** real-time day and night (the actual sun over the actual Earth) */
  readonly night = new NightLayer();
  /** lit windows for the zoomed-in view at night (derived from the tile art once the sheet loads) */
  private nightLights: NightLights | null = null;
  private speckle: CanvasPattern | null = null;
  private flightTimer: ReturnType<typeof setTimeout> | null = null;
  /** transient marker (pulsing red ring) around a tile, e.g. after clicking a fire toast */
  private flash: { x: number; y: number; t0: number } | null = null;
  /** other players' markers, interpolated between presence frames */
  readonly presence: PresenceTracker;
  private presenceTimer: ReturnType<typeof setTimeout> | null = null;
  /** test hooks: what the last frame drew */
  drawnClaims = new Map<string, ClaimStyle>();
  drawnPresence: DrawnPresence[] = [];

  constructor(
    readonly canvas: HTMLCanvasElement,
    public sheet: SpriteSheet,
    public minimap: Minimap,
    readonly map: TileMap,
    readonly state: AppState,
    opts: { animated?: boolean } = {},
  ) {
    super();
    this.animated = opts.animated ?? true;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2d context unavailable');
    this.ctx = ctx;
    map.on('chunk', () => this.invalidate());
    this.overlay = new OverlayLayer(map);
    // police reach doubles in a city with a powered university: the overlay asks who owns what
    this.overlay.ownerAt = (x, y) => this.state.claims.get(chunkKey(Math.floor(x / CHUNK), Math.floor(y / CHUNK)))?.ownerId;
    this.overlay.uniOwners = () => {
      const out = new Set<string>();
      for (const b of this.customs.ofKind('university')) {
        const v = this.map.get(b.x + 1, b.y + 1);
        const o = this.overlay.ownerAt(b.x + 1, b.y + 1);
        if (v !== undefined && (v & PWRBIT) && o) out.add(o);
      }
      return out;
    };
    try { this.nightLights = new NightLights(sheet); this.nightLights.onReady = () => this.invalidate(); } catch { this.nightLights = null; }
    this.customs.onChange = () => this.invalidate();
    // day and night move with the real sun: check once a minute and redraw when the shade changed
    if (this.animated) setInterval(() => { if (this.night.update()) this.invalidate(); }, NIGHT_REFRESH_MS);
    this.customs.load();
    this.overlay.isOwn = (cx, cy) => this.state.ownsChunk(cx, cy);
    map.on('tiles', () => this.invalidate());
    map.on('drop', (key) => { this.chunkCanvases.delete(key); this.invalidate(); });
    state.on('claims', () => this.invalidate());
    state.on('stats', () => this.invalidate());
    state.on('tool', () => this.invalidate());
    state.on('me', () => { this.chunkCanvases.clear(); this.invalidate(); });
    this.presence = new PresenceTracker(state);
    state.on('presence', () => {
      this.invalidate();
      // when frames stop, one more redraw after the stale timeout removes the markers
      if (this.animated) {
        if (this.presenceTimer) clearTimeout(this.presenceTimer);
        this.presenceTimer = setTimeout(() => { this.presenceTimer = null; this.invalidate(); }, PRESENCE_STALE_MS + 50);
      }
    });
  }

  // ---------- sizing ----------
  setSize(cssW: number, cssH: number, dpr = 1): void {
    const wasFit = this.cam.zoom <= this.fitZoom() * 1.001;
    this.cssW = Math.max(1, cssW); this.cssH = Math.max(1, cssH); this.dpr = dpr;
    this.canvas.width = Math.round(this.cssW * dpr);
    this.canvas.height = Math.round(this.cssH * dpr);
    if (wasFit) this.cam.zoom = this.fitZoom();
    this.setCamera(this.cam.x, this.cam.y, this.cam.zoom);
    this.invalidate();
  }

  resizeToWindow(): void {
    // Measure the canvas itself: on phones window.innerHeight and the CSS height differ while the
    // address bar is visible, and a mismatch stretches the bitmap so taps land on the wrong tile.
    const r = this.canvas.getBoundingClientRect();
    const w = r.width > 0 ? r.width : window.innerWidth, h = r.height > 0 ? r.height : window.innerHeight;
    this.setSize(w, h, Math.min(2, window.devicePixelRatio || 1));
  }

  // ---------- camera ----------
  tilePx(): number { return TILE_PX * this.cam.zoom; }
  isTileMode(): boolean { return this.cam.zoom >= TILE_MODE_ZOOM - 1e-9; }
  fitZoom(): number { return Math.min(this.cssW / (WORLD_W * TILE_PX), this.cssH / (WORLD_H * TILE_PX)); }
  minZoom(): number { return Math.min(this.fitZoom(), TILE_MODE_ZOOM); }

  zoomLevels(): number[] {
    const fit = this.fitZoom();
    const levels = [MAX_ZOOM, 2, 1, TILE_MODE_ZOOM];
    let z = TILE_MODE_ZOOM;
    while (z / 2 > fit * 1.15) { z /= 2; levels.push(z); }
    levels.push(fit);
    return [...new Set(levels)].sort((a, b) => a - b);
  }

  setCamera(x: number, y: number, zoom: number): void {
    zoom = clamp(zoom, this.minZoom(), MAX_ZOOM);
    const halfW = this.cssW / 2 / (TILE_PX * zoom);
    const halfH = this.cssH / 2 / (TILE_PX * zoom);
    x = halfW * 2 >= WORLD_W ? WORLD_W / 2 : clamp(x, halfW, WORLD_W - halfW);
    y = halfH * 2 >= WORLD_H ? WORLD_H / 2 : clamp(y, halfH, WORLD_H - halfH);
    const changed = x !== this.cam.x || y !== this.cam.y || zoom !== this.cam.zoom;
    this.cam = { x, y, zoom };
    if (changed) {
      this.invalidate();
      this.emit('camera', this.cam);
    }
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => { this.settleTimer = null; this.emit('settle', this.cam); }, SETTLE_MS);
  }

  panBy(dxCss: number, dyCss: number): void {
    this.fly = null;
    const tp = this.tilePx();
    this.setCamera(this.cam.x - dxCss / tp, this.cam.y - dyCss / tp, this.cam.zoom);
  }

  /** Change zoom keeping the world point under (cssX, cssY) fixed. */
  zoomAround(cssX: number, cssY: number, zoom: number): void {
    this.fly = null;
    zoom = clamp(zoom, this.minZoom(), MAX_ZOOM);
    const before = this.screenToTile(cssX, cssY);
    const tp = TILE_PX * zoom;
    const x = before.x - (cssX - this.cssW / 2) / tp;
    const y = before.y - (cssY - this.cssH / 2) / tp;
    this.setCamera(x, y, zoom);
  }

  zoomStep(dir: 1 | -1, cssX = this.cssW / 2, cssY = this.cssH / 2): void {
    const levels = this.zoomLevels();
    const z = this.cam.zoom;
    let target = z;
    if (dir > 0) { const next = levels.find((l) => l > z * 1.001); target = next ?? levels[levels.length - 1]; }
    else { const prev = [...levels].reverse().find((l) => l < z / 1.001); target = prev ?? levels[0]; }
    this.zoomAround(cssX, cssY, target);
  }

  flyTo(x: number, y: number, zoom: number, ms = 700): void {
    zoom = clamp(zoom, this.minZoom(), MAX_ZOOM);
    this.fly = { from: { ...this.cam }, to: { x, y, zoom }, t0: performance.now(), ms };
    this.invalidate();
  }

  /** Flash a pulsing ring around tile (x,y) for ~2 s. */
  flashTile(x: number, y: number, now = performance.now()): void {
    this.flash = { x, y, t0: now };
    this.invalidate();
  }
  get flashActive(): boolean { return this.flash !== null; }

  /** Fit the whole world in the window. */
  showWorld(): void { this.fly = null; this.setCamera(WORLD_W / 2, WORLD_H / 2, this.fitZoom()); }

  screenToTile(cssX: number, cssY: number): { x: number; y: number } {
    const tp = this.tilePx();
    return { x: this.cam.x + (cssX - this.cssW / 2) / tp, y: this.cam.y + (cssY - this.cssH / 2) / tp };
  }
  tileToScreen(tx: number, ty: number): { x: number; y: number } {
    const tp = this.tilePx();
    return { x: (tx - this.cam.x) * tp + this.cssW / 2, y: (ty - this.cam.y) * tp + this.cssH / 2 };
  }
  /** The plane or ship drawn under a screen point (CSS px), if any: the nearest within reach of its sprite. */
  pickVehicle(cssX: number, cssY: number): { kind: 'plane'; flight: Flight } | { kind: 'ship'; voyage: Voyage } | null {
    const reach = Math.max(14, this.isTileMode() ? this.tilePx() * 1.5 : 10);
    let best: { kind: 'plane'; flight: Flight } | { kind: 'ship'; voyage: Voyage } | null = null, bestD = reach;
    const dist = (tx: number, ty: number): number => {
      let d = Infinity;
      for (const off of [0, -WORLD_W, WORLD_W]) { const p = this.tileToScreen(tx + off, ty); d = Math.min(d, Math.hypot(p.x - cssX, p.y - cssY)); }
      return d;
    };
    if (this.flightLayer.interCity) for (const f of this.flightLayer.flights()) { const d = dist(f.x, f.y); if (d < bestD) { bestD = d; best = { kind: 'plane', flight: f }; } }
    for (const v of this.shipLayer.voyages()) { const d = dist(v.x, v.y); if (d < bestD) { bestD = d; best = { kind: 'ship', voyage: v }; } }
    return best;
  }

  /** Visible world rect in tile units. */
  viewRect(): { x0: number; y0: number; x1: number; y1: number } {
    const a = this.screenToTile(0, 0), b = this.screenToTile(this.cssW, this.cssH);
    return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
  }
  centerChunk(): { cx: number; cy: number } {
    return { cx: clamp(Math.floor(this.cam.x / CHUNK), 0, CHUNKS_X - 1), cy: clamp(Math.floor(this.cam.y / CHUNK), 0, CHUNKS_Y - 1) };
  }

  visibleChunkRect(margin = 0): ChunkRect {
    const v = this.viewRect();
    return {
      cx0: clamp(Math.floor(v.x0 / CHUNK) - margin, 0, CHUNKS_X - 1),
      cy0: clamp(Math.floor(v.y0 / CHUNK) - margin, 0, CHUNKS_Y - 1),
      cx1: clamp(Math.floor((v.x1 - 1e-6) / CHUNK) + margin, 0, CHUNKS_X - 1),
      cy1: clamp(Math.floor((v.y1 - 1e-6) / CHUNK) + margin, 0, CHUNKS_Y - 1),
    };
  }

  /** Chunks the client wants subscribed for the current camera: viewport + 1 chunk margin, capped, nearest first. */
  desiredSubscription(): [number, number][] {
    if (!this.isTileMode()) return [];
    const r = this.visibleChunkRect(1);
    const out: [number, number][] = [];
    for (let cy = r.cy0; cy <= r.cy1; cy++) for (let cx = r.cx0; cx <= r.cx1; cx++) out.push([cx, cy]);
    const ccx = this.cam.x / CHUNK - 0.5, ccy = this.cam.y / CHUNK - 0.5;
    out.sort((a, b) => ((a[0] - ccx) ** 2 + (a[1] - ccy) ** 2) - ((b[0] - ccx) ** 2 + (b[1] - ccy) ** 2));
    return out.slice(0, MAX_SUBSCRIBED_CHUNKS);
  }

  setHover(p: TilePos | null): void {
    const same = (!p && !this.hover) || (!!p && !!this.hover && p.x === this.hover.x && p.y === this.hover.y);
    if (same) return;
    this.hover = p;
    this.emit('hover', p);
    this.invalidate();
  }

  // ---------- frame scheduling ----------
  invalidate(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    if (this.animated) requestAnimationFrame(() => { this.scheduled = false; this.render(); });
    else this.scheduled = false;
  }

  private stepFly(now: number): void {
    const f = this.fly;
    if (!f) return;
    const t = clamp((now - f.t0) / f.ms, 0, 1);
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    // interpolate zoom geometrically, position linearly
    const zoom = f.from.zoom * (f.to.zoom / f.from.zoom) ** e;
    this.setCamera(f.from.x + (f.to.x - f.from.x) * e, f.from.y + (f.to.y - f.from.y) * e, zoom);
    if (t >= 1) this.fly = null; else this.invalidate();
  }

  // ---------- rendering ----------
  render(now = performance.now()): void {
    this.frame++;
    this.stepFly(now);
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#05080f';
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.processDirty();
    this.visibleAnim.length = 0;
    this.drawnClaims.clear();
    if (this.isTileMode()) this.renderTiles(g, now); else this.renderOverview(g);
    this.renderFlights(g);
    this.renderPresence(g, now);
    this.renderFlash(g, now);
    this.evictCanvases();
    if (this.pendingBuilds > 0) this.invalidate();
    if (this.visibleAnim.length && this.animated) this.scheduleAnim();
  }

  // ---------- tile animation ----------
  /** True when at least one animated tile (fire, smoke, traffic, ...) was blitted in the last frame. */
  get animVisible(): boolean { return this.visibleAnim.length > 0; }
  /** True when a tile animation timer is pending (test hook: must be false while nothing animated is on screen). */
  get animTimerPending(): boolean { return this.animTimer !== null; }

  private scheduleAnim(): void {
    if (this.animTimer) return;
    this.animTimer = setTimeout(() => { this.animTimer = null; this.stepAnim(); }, ANIM_MS);
  }

  /** Advance every animated tile of the on-screen chunks one frame through ANI_TILE, redraw just those tiles, invalidate. */
  stepAnim(): void {
    if (!this.visibleAnim.length) return; // nothing animated on screen: costs nothing
    this.animStep++;
    for (const cc of this.visibleAnim) {
      if (this.chunkCanvases.get(cc.key) !== cc) continue; // evicted or rebuilt since the last frame
      const { cx, cy } = parseChunkKey(cc.key);
      const tiles = this.map.getChunk(cx, cy);
      if (!tiles) continue;
      const own = this.state.ownsChunk(cx, cy);
      for (const idx of cc.anim) {
        const cur = cc.frame.get(idx) ?? (tiles[idx] & LOMASK);
        const next = ANI_TILE[cur];
        if (next === undefined || next === cur) continue;
        cc.frame.set(idx, next);
        this.drawFrame(cc, tiles[idx], idx, next, own);
      }
    }
    this.invalidate();
  }

  /** Test hook: the tile id currently drawn for world tile (x,y), or undefined if its chunk canvas is not built. */
  frameAt(x: number, y: number): number | undefined {
    const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK);
    const cc = this.chunkCanvases.get(chunkKey(cx, cy));
    if (!cc) return undefined;
    const idx = (y - cy * CHUNK) * CHUNK + (x - cx * CHUNK);
    return cc.frame.get(idx) ?? ((this.map.getChunk(cx, cy)?.[idx] ?? 0) & LOMASK);
  }

  /** Test hook: number of animated tiles tracked in a chunk's canvas. */
  animCount(cx: number, cy: number): number { return this.chunkCanvases.get(chunkKey(cx, cy))?.anim.size ?? 0; }

  // ---------- sprites ----------
  private renderSprites(g: CanvasRenderingContext2D, now: number): void {
    const s = this.sprites;
    if (!s) return;
    const v = this.viewRect(), r = this.visibleChunkRect(0);
    const more = s.frame(now, { ...v, ...r });
    s.draw(g, (tx, ty) => ({ x: this.dx(tx), y: this.dy(ty) }), this.tilePx() * this.dpr);
    if (more && this.animated) this.invalidate();
  }

  private renderFlights(g: CanvasRenderingContext2D): void {
    const flights = this.flightLayer.interCity ? this.flightLayer.flights() : [];
    const ships = this.shipLayer.voyages();
    if (!flights.length && !ships.length) { if (this.flightLayer.interCity || this.shipLayer.routes.length) this.scheduleFlights(2000); return; }
    const W = this.canvas.width, H = this.canvas.height, d = this.dpr;
    const tile = this.isTileMode();
    // the world wraps at the date line: try the position and its copies one world-width either side
    const toPx = (tx: number, ty: number) => {
      for (const off of [0, -FLIGHT_WORLD_W, FLIGHT_WORLD_W]) {
        const x = this.dx(tx + off), y = this.dy(ty);
        if (x > -64 * d && x < W + 64 * d && y > -64 * d && y < H + 64 * d) return { x, y };
      }
      return null;
    };
    let visible = 0;
    for (const f of flights) if (toPx(f.x, f.y)) visible++;
    for (const v of ships) if (toPx(v.x, v.y)) visible++;
    if (tile) {
      // zoomed in: the Micropolis sprites at true scale (48px sprite = 3 tiles)
      if (this.sprites) {
        this.sprites.drawFlights(g, flights, toPx, this.tilePx() * d * 3);
        this.sprites.drawShips(g, ships, toPx, this.tilePx() * d * 3);
      }
    } else {
      // world map: simple shapes and faint trails
      g.save();
      g.lineWidth = Math.max(1, Math.round(d));
      g.setLineDash([Math.round(3 * d), Math.round(4 * d)]);
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      for (const f of flights) {
        const curX = f.fromX + (f.toX - f.fromX) * f.progress;
        for (const off of [0, -FLIGHT_WORLD_W, FLIGHT_WORLD_W]) { g.beginPath(); g.moveTo(this.dx(f.fromX + off), this.dy(f.fromY)); g.lineTo(this.dx(curX + off), this.dy(f.y)); g.stroke(); }
      }
      g.strokeStyle = 'rgba(160,220,255,0.45)';
      for (const v of ships) for (const off of [0, -FLIGHT_WORLD_W, FLIGHT_WORLD_W]) {
        g.beginPath(); g.moveTo(this.dx(v.trail[0] + off), this.dy(v.trail[1]));
        for (let i = 2; i < v.trail.length; i += 2) g.lineTo(this.dx(v.trail[i] + off), this.dy(v.trail[i + 1]));
        g.stroke();
      }
      g.setLineDash([]);
      const r = Math.round(5 * d);
      for (const f of flights) {
        const at = toPx(f.x, f.y); if (!at) continue;
        // plane: a white arrowhead pointing where it flies
        const len = Math.hypot(f.vx, f.vy) || 1, ux = f.vx / len, uy = f.vy / len;
        g.fillStyle = '#ffffff'; g.strokeStyle = 'rgba(0,0,0,0.75)';
        g.beginPath();
        g.moveTo(at.x + ux * r * 1.6, at.y + uy * r * 1.6);
        g.lineTo(at.x - ux * r + uy * r, at.y - uy * r - ux * r);
        g.lineTo(at.x - ux * r * 0.4, at.y - uy * r * 0.4);
        g.lineTo(at.x - ux * r - uy * r, at.y - uy * r + ux * r);
        g.closePath(); g.fill(); g.stroke();
      }
      for (const v of ships) {
        const at = toPx(v.x, v.y); if (!at) continue;
        // ship: a small hull along its heading
        const ux = v.vx, uy = v.vy, hw = r * 0.55;
        g.fillStyle = '#e8eef5'; g.strokeStyle = 'rgba(0,30,80,0.9)';
        g.beginPath();
        g.moveTo(at.x + ux * r * 1.4, at.y + uy * r * 1.4);
        g.lineTo(at.x + ux * r * 0.3 + uy * hw, at.y + uy * r * 0.3 - ux * hw);
        g.lineTo(at.x - ux * r * 1.1 + uy * hw, at.y - uy * r * 1.1 - ux * hw);
        g.lineTo(at.x - ux * r * 1.1 - uy * hw, at.y - uy * r * 1.1 + ux * hw);
        g.lineTo(at.x + ux * r * 0.3 - uy * hw, at.y + uy * r * 0.3 + ux * hw);
        g.closePath(); g.fill(); g.stroke();
      }
      g.restore();
    }
    if (visible > 0) {
      if (tile) { if (this.animated) this.invalidate(); } else this.scheduleFlights(100);
    } else this.scheduleFlights(1000);
  }

  /** Redraw later for flights (overview needs ~10 fps; off-screen flights only a slow check). */
  private scheduleFlights(ms: number): void {
    if (!this.animated || this.flightTimer) return;
    this.flightTimer = setTimeout(() => { this.flightTimer = null; this.invalidate(); }, ms);
  }

  private renderFlash(g: CanvasRenderingContext2D, now: number): void {
    const f = this.flash;
    if (!f) return;
    const t = (now - f.t0) / FLASH_MS;
    if (t >= 1) { this.flash = null; return; }
    const cxp = (this.dx(f.x) + this.dx(f.x + 1)) / 2, cyp = (this.dy(f.y) + this.dy(f.y + 1)) / 2;
    const pulse = (now - f.t0) % 600 / 600; // 0..1 three times
    const base = Math.max(this.tilePx() * this.dpr * 0.7, 8 * this.dpr);
    const rad = base + pulse * base * 1.6;
    g.lineWidth = Math.max(2, Math.round(3 * this.dpr));
    g.strokeStyle = `rgba(255,70,50,${(1 - pulse) * (1 - t * 0.5)})`;
    g.beginPath(); g.arc(cxp, cyp, rad, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = 'rgba(255,200,80,0.9)';
    g.lineWidth = Math.max(1, Math.round(1.5 * this.dpr));
    g.beginPath(); g.arc(cxp, cyp, base * 0.6, 0, Math.PI * 2); g.stroke();
    if (this.animated) this.invalidate();
  }

  /** device-pixel x of a world tile x coordinate */
  private dx(tx: number): number { return Math.round(((tx - this.cam.x) * this.tilePx() + this.cssW / 2) * this.dpr); }
  private dy(ty: number): number { return Math.round(((ty - this.cam.y) * this.tilePx() + this.cssH / 2) * this.dpr); }

  private getChecker(g: CanvasRenderingContext2D): CanvasPattern | null {
    if (this.checker) return this.checker;
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const cg = c.getContext('2d')!;
    cg.fillStyle = '#0c1018'; cg.fillRect(0, 0, 32, 32);
    cg.fillStyle = '#121824'; cg.fillRect(0, 0, 16, 16); cg.fillRect(16, 16, 16, 16);
    this.checker = g.createPattern(c, 'repeat');
    return this.checker;
  }

  private renderTiles(g: CanvasRenderingContext2D, now: number): void {
    const r = this.visibleChunkRect(0);
    const W = this.canvas.width, H = this.canvas.height;
    this.pendingBuilds = 0;
    let built = 0;
    // 1. chunk blits
    for (let cy = r.cy0; cy <= r.cy1; cy++) {
      for (let cx = r.cx0; cx <= r.cx1; cx++) {
        const x0 = this.dx(cx * CHUNK), x1 = this.dx((cx + 1) * CHUNK);
        const y0 = this.dy(cy * CHUNK), y1 = this.dy((cy + 1) * CHUNK);
        if (x1 <= 0 || y1 <= 0 || x0 >= W || y0 >= H) continue;
        const key = chunkKey(cx, cy);
        let cc = this.chunkCanvases.get(key);
        if (!cc) {
          const tiles = this.map.getChunk(cx, cy);
          if (tiles && built < CHUNK_BUILD_BUDGET) { cc = this.buildChunkCanvas(key, cx, cy, tiles); built++; }
          else if (tiles) this.pendingBuilds++;
        }
        if (cc) {
          cc.lastUse = this.frame;
          if (cc.anim.size) this.visibleAnim.push(cc);
          g.drawImage(cc.canvas, 0, 0, CHUNK_PX, CHUNK_PX, x0, y0, x1 - x0, y1 - y0);
        } else {
          g.fillStyle = this.getChecker(g) ?? '#0c1018';
          g.fillRect(x0, y0, x1 - x0, y1 - y0);
          if (this.subscribed.has(key)) {
            g.fillStyle = 'rgba(255,255,255,0.35)';
            g.font = `${Math.round(11 * this.dpr)}px ui-monospace, monospace`;
            g.textBaseline = 'middle'; g.textAlign = 'center';
            g.fillText('loading…', (x0 + x1) / 2, (y0 + y1) / 2);
          }
        }
      }
    }
    // 1. custom-layer buildings: one image over the whole footprint (+ the unpowered bolt for your own)
    let customAnimMs = Infinity;
    {
      const v = this.viewRect();
      g.imageSmoothingEnabled = false;
      for (const b of this.customs.within(Math.floor(v.x0), Math.floor(v.y0), Math.ceil(v.x1), Math.ceil(v.y1))) {
        const img = this.customs.ready(b.kind);
        const x0 = this.dx(b.x), y0 = this.dy(b.y), x1 = this.dx(b.x + b.w), y1 = this.dy(b.y + b.h);
        const def = CUSTOM_BUILDINGS[b.kind];
        if (img && def?.frames && def.frameMs) {
          // animated building: a strip of frames, all players see the same frame (wall clock)
          const fw = img.naturalWidth / def.frames;
          const f = Math.floor(Date.now() / def.frameMs) % def.frames;
          g.drawImage(img, f * fw, 0, fw, img.naturalHeight, x0, y0, x1 - x0, y1 - y0);
          customAnimMs = Math.min(customAnimMs, def.frameMs - (Date.now() % def.frameMs) + 5);
        } else if (img) g.drawImage(img, x0, y0, x1 - x0, y1 - y0);
        const cv = this.map.get(b.x + 1, b.y + 1);
        if (cv !== undefined && (cv & ZONEBIT) && !(cv & PWRBIT) && this.state.ownsChunk(Math.floor((b.x + 1) / CHUNK), Math.floor((b.y + 1) / CHUNK))) {
          const t = this.tilePx() * this.dpr;
          drawTile(g, this.sheet, LIGHTNINGBOLT, this.dx(b.x + 1), this.dy(b.y + 1), t, t);
        }
      }
    }
    if (customAnimMs < Infinity && this.animated && !this.customAnimTimer) {
      this.customAnimTimer = setTimeout(() => { this.customAnimTimer = null; this.invalidate(); }, customAnimMs);
    }
    // 1b. night: the real-time shade over the city (dimmed, never dark), then the lit windows of plots in the dark
    this.night.update();
    {
      const v = this.viewRect();
      const x0w = Math.max(0, v.x0), y0w = Math.max(0, v.y0), x1w = Math.min(WORLD_W, v.x1), y1w = Math.min(WORLD_H, v.y1);
      const nc = this.night.canvas;
      if (x1w > x0w && y1w > y0w) {
        g.imageSmoothingEnabled = true;
        g.globalAlpha = NIGHT_CITY_DIM;
        g.drawImage(nc, (x0w / WORLD_W) * nc.width, (y0w / WORLD_H) * nc.height, ((x1w - x0w) / WORLD_W) * nc.width, ((y1w - y0w) / WORLD_H) * nc.height,
          this.dx(x0w), this.dy(y0w), this.dx(x1w) - this.dx(x0w), this.dy(y1w) - this.dy(y0w));
        g.globalAlpha = 1;
        g.imageSmoothingEnabled = false;
      }
      if (this.nightLights) {
        for (let cy = r.cy0; cy <= r.cy1; cy++) for (let cx = r.cx0; cx <= r.cx1; cx++) {
          const lvl = this.nightAtChunk(cx, cy);
          if (lvl < 0.05) continue;
          const tiles = this.map.getChunk(cx, cy);
          if (!tiles) continue;
          const x0 = this.dx(cx * CHUNK), x1 = this.dx((cx + 1) * CHUNK), y0 = this.dy(cy * CHUNK), y1 = this.dy((cy + 1) * CHUNK);
          if (x1 <= 0 || y1 <= 0 || x0 >= W || y0 >= H) continue;
          const im = this.nightLights.canvasFor(chunkKey(cx, cy), tiles, now);
          if (im) this.drawNightImage(g, im, lvl, x0, y0, x1 - x0, y1 - y0);
        }
        for (const b of this.customs.within(Math.floor(v.x0), Math.floor(v.y0), Math.ceil(v.x1), Math.ceil(v.y1))) {
          const def = CUSTOM_BUILDINGS[b.kind];
          const lvl = def ? this.nightAtChunk(Math.floor(b.x / CHUNK), Math.floor(b.y / CHUNK)) : 0;
          if (lvl < 0.05) continue;
          const lights = this.nightLights.forCustom(def.image);
          if (!lights) continue;
          this.drawNightImage(g, lights, lvl, this.dx(b.x), this.dy(b.y), this.dx(b.x + b.w) - this.dx(b.x), this.dy(b.y + b.h) - this.dy(b.y));
        }
        g.globalAlpha = 1;
      }
    }
    // 1a. map overlay: dim the city, then one pixel per tile from the overlay layer
    if (this.overlay.mode !== 'none') {
      this.overlay.ownCrime = this.state.stats?.crime ?? 0;
      g.fillStyle = 'rgba(6,8,14,0.55)';
      g.fillRect(0, 0, W, H);
      g.imageSmoothingEnabled = false;
      for (let cy = r.cy0; cy <= r.cy1; cy++) for (let cx = r.cx0; cx <= r.cx1; cx++) {
        const x0 = this.dx(cx * CHUNK), x1 = this.dx((cx + 1) * CHUNK), y0 = this.dy(cy * CHUNK), y1 = this.dy((cy + 1) * CHUNK);
        if (x1 <= 0 || y1 <= 0 || x0 >= W || y0 >= H) continue;
        const oc = this.overlay.canvasFor(cx, cy);
        if (oc) g.drawImage(oc, x0, y0, x1 - x0, y1 - y0);
      }
    }
    // 1b. sprites above the tiles, below outlines / labels / cursor
    if (this.overlay.mode === 'none') this.renderSprites(g, now);
    // 2. chunk borders + claims
    g.lineWidth = Math.max(1, Math.round(this.dpr));
    const me = this.state.me;
    const labelFont = `${Math.round(12 * this.dpr)}px ui-monospace, Menlo, Consolas, monospace`;
    const labelled = new Set<string>();
    for (let cy = r.cy0; cy <= r.cy1; cy++) {
      for (let cx = r.cx0; cx <= r.cx1; cx++) {
        const x0 = this.dx(cx * CHUNK), x1 = this.dx((cx + 1) * CHUNK);
        const y0 = this.dy(cy * CHUNK), y1 = this.dy((cy + 1) * CHUNK);
        const claim = this.state.claimAt(cx, cy);
        if (claim) {
          const own = !!me && claim.ownerId === me.id;
          const st = claimStyle(claim, own);
          this.drawnClaims.set(chunkKey(cx, cy), st);
          // No tint over the artwork: ownership is shown by an outline around the whole city (only the
          // edges that face land this city does not own are drawn, so multi-plot cities merge into one
          // shape) plus one name chip per city. Fills are only used in the overview.
          const bw = Math.max(2, Math.round((own ? 3 : 2) * this.dpr));
          const inset = bw / 2 + 1;
          const edges: [number, number, number, number][] = [];
          if (!this.sameOwner(cx, cy - 1, claim.ownerId)) edges.push([x0, y0 + inset, x1, y0 + inset]);
          if (!this.sameOwner(cx, cy + 1, claim.ownerId)) edges.push([x0, y1 - inset, x1, y1 - inset]);
          if (!this.sameOwner(cx - 1, cy, claim.ownerId)) edges.push([x0 + inset, y0, x0 + inset, y1]);
          if (!this.sameOwner(cx + 1, cy, claim.ownerId)) edges.push([x1 - inset, y0, x1 - inset, y1]);
          if (edges.length) {
            g.setLineDash(st.abandoned ? [Math.round(10 * this.dpr), Math.round(7 * this.dpr)] : []);
            for (const [pass, style, lw] of [
              [0, 'rgba(0,0,0,0.45)', bw + Math.max(2, Math.round(2 * this.dpr))],
              [1, st.abandoned ? 'rgba(200,200,200,0.9)' : withAlpha(st.color, own ? 1 : 0.85), bw],
            ] as [number, string, number][]) {
              void pass;
              g.strokeStyle = style; g.lineWidth = lw; g.beginPath();
              for (const [ax, ay, bx, by] of edges) { g.moveTo(ax, ay); g.lineTo(bx, by); }
              g.stroke();
            }
            g.setLineDash([]);
          }
          if (!labelled.has(claim.ownerId) && x1 - x0 >= 90 * this.dpr) {
            // one label per city: on the first (top-left-most) visible plot, in the visible part of it
            // and out from under the toolbar / top bar, so partially scrolled plots stay identifiable
            labelled.add(claim.ownerId);
            g.font = labelFont; g.textBaseline = 'top'; g.textAlign = 'left';
            const tw = g.measureText(st.label).width;
            const px = Math.round(6 * this.dpr), py = Math.round(4 * this.dpr);
            const insetL = Math.round(this.overlayInset.left * this.dpr), insetT = Math.round(this.overlayInset.top * this.dpr);
            const lx = x1 - insetL >= tw + 3 * px ? Math.max(x0, insetL) : Math.max(x0, 0);
            const ly = y1 - insetT >= 40 * this.dpr ? Math.max(y0, insetT) : Math.max(y0, 0);
            g.fillStyle = 'rgba(0,0,0,0.55)';
            g.fillRect(lx + px, ly + py, tw + px, Math.round(16 * this.dpr));
            g.fillStyle = st.abandoned ? '#b8b8b8' : st.color;
            g.fillText(st.label, lx + px + px / 2, ly + py + Math.round(2 * this.dpr));
          }
        } else {
          g.strokeStyle = 'rgba(255,255,255,0.08)';
          g.lineWidth = Math.max(1, Math.round(this.dpr));
          g.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);
        }
      }
    }
    // 3. world edge
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    g.strokeRect(this.dx(0) + 0.5, this.dy(0) + 0.5, this.dx(WORLD_W) - this.dx(0) - 1, this.dy(WORLD_H) - this.dy(0) - 1);
    // 4. tool footprint
    this.renderCursor(g);
  }

  private renderCursor(g: CanvasRenderingContext2D): void {
    const h = this.hover;
    if (!h || !inWorld(h.x, h.y)) return;
    const tool = TOOLS[this.state.tool];
    const { x0, y0 } = footprintOrigin(tool, h.x, h.y);
    const fw = toolW(tool), fh = toolH(tool);
    let ok = this.state.funds >= tool.cost;
    if (tool.id !== 'query') {
      for (let y = y0; y < y0 + fh && ok; y++) for (let x = x0; x < x0 + fw; x++) {
        if (!inWorld(x, y) || !this.state.ownsChunk(Math.floor(x / CHUNK), Math.floor(y / CHUNK))) { ok = false; break; }
      }
    }
    const px0 = this.dx(x0), py0 = this.dy(y0), px1 = this.dx(x0 + fw), py1 = this.dy(y0 + fh);
    g.fillStyle = ok ? 'rgba(255,255,255,0.12)' : 'rgba(255,60,60,0.18)';
    g.fillRect(px0, py0, px1 - px0, py1 - py0);
    g.lineWidth = Math.max(2, Math.round(2 * this.dpr));
    g.strokeStyle = ok ? 'rgba(255,255,255,0.95)' : 'rgba(255,70,70,0.95)';
    g.strokeRect(px0 + 1, py0 + 1, px1 - px0 - 2, py1 - py0 - 2);
  }

  private renderOverview(g: CanvasRenderingContext2D): void {
    const W = this.canvas.width, H = this.canvas.height;
    const left = this.dx(0), top = this.dy(0), right = this.dx(WORLD_W), bottom = this.dy(WORLD_H);
    g.imageSmoothingEnabled = false;
    g.drawImage(this.minimap.image, 0, 0, this.minimap.width, this.minimap.height, left, top, right - left, bottom - top);
    // static speckle, anchored to the world one pattern pixel per tile (from one screen pixel per tile up)
    const tpx = this.tilePx() * this.dpr;
    if (tpx >= 1) {
      if (!this.speckle) this.speckle = g.createPattern(speckleTile(), 'repeat');
      if (this.speckle) {
        this.speckle.setTransform(new DOMMatrix().translateSelf(left, top).scaleSelf(tpx, tpx));
        g.fillStyle = this.speckle;
        g.fillRect(Math.max(0, left), Math.max(0, top), Math.min(W, right) - Math.max(0, left), Math.min(H, bottom) - Math.max(0, top));
      }
    }
    // plots as one-pixel-per-tile images of what is built there (snapshot refreshed every 30 s)
    this.overviewMap.maybeRefresh();
    {
      const vr = this.visibleChunkRect(0);
      g.imageSmoothingEnabled = tpx < 1; // average when shrinking below a pixel per tile, crisp otherwise
      for (const claim of this.state.claims.values()) {
        if (claim.cx < vr.cx0 || claim.cx > vr.cx1 || claim.cy < vr.cy0 || claim.cy > vr.cy1) continue;
        const img = this.overviewMap.canvasFor(claim.cx, claim.cy);
        if (!img) continue;
        const x0 = this.dx(claim.cx * CHUNK), x1 = this.dx((claim.cx + 1) * CHUNK);
        const y0 = this.dy(claim.cy * CHUNK), y1 = this.dy((claim.cy + 1) * CHUNK);
        g.drawImage(img, x0, y0, x1 - x0, y1 - y0);
      }
      g.imageSmoothingEnabled = false;
    }
    // night: the real-time shade over the whole map, then the lights of every city on the dark side
    this.night.update();
    g.imageSmoothingEnabled = true;
    g.drawImage(this.night.canvas, left, top, right - left, bottom - top);
    {
      const vr = this.visibleChunkRect(0);
      g.imageSmoothingEnabled = tpx < 1;
      g.globalCompositeOperation = 'lighter';
      // below a pixel per tile the lights average out, so draw them twice to keep cities glowing
      const passes = tpx < 1 ? 2 : 1;
      for (const claim of this.state.claims.values()) {
        if (claim.cx < vr.cx0 || claim.cx > vr.cx1 || claim.cy < vr.cy0 || claim.cy > vr.cy1) continue;
        const lights = this.overviewMap.lightsFor(claim.cx, claim.cy);
        if (!lights) continue;
        const lvl = this.nightAtChunk(claim.cx, claim.cy);
        if (lvl < 0.05) continue;
        g.globalAlpha = lvl;
        const x0 = this.dx(claim.cx * CHUNK), x1 = this.dx((claim.cx + 1) * CHUNK);
        const y0 = this.dy(claim.cy * CHUNK), y1 = this.dy((claim.cy + 1) * CHUNK);
        for (let k = 0; k < passes; k++) g.drawImage(lights, x0, y0, x1 - x0, y1 - y0);
        // zoomed far out a plot is a few pixels: give lit cities a soft warm glow, like Earth at night
        const share = this.overviewMap.litShareOf(claim.cx, claim.cy);
        if (tpx < 0.6 && share > 0.01) {
          const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, rad = Math.max(5 * this.dpr, (x1 - x0) * 1.3);
          const grad = g.createRadialGradient(mx, my, 0, mx, my, rad);
          grad.addColorStop(0, `rgba(255, 205, 120, ${Math.min(0.55, 0.15 + share * 2) * lvl})`);
          grad.addColorStop(1, 'rgba(255, 205, 120, 0)');
          g.globalAlpha = 1;
          g.fillStyle = grad;
          g.fillRect(mx - rad, my - rad, rad * 2, rad * 2);
          g.globalAlpha = lvl;
        }
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
      g.imageSmoothingEnabled = false;
    }
    // chunk grid at the higher overview zooms
    if (this.cam.zoom >= 0.125) {
      const r = this.visibleChunkRect(0);
      g.strokeStyle = 'rgba(255,255,255,0.06)';
      g.lineWidth = 1;
      g.beginPath();
      for (let cx = r.cx0; cx <= r.cx1 + 1; cx++) { const x = this.dx(cx * CHUNK) + 0.5; g.moveTo(x, Math.max(0, top)); g.lineTo(x, Math.min(H, bottom)); }
      for (let cy = r.cy0; cy <= r.cy1 + 1; cy++) { const y = this.dy(cy * CHUNK) + 0.5; g.moveTo(Math.max(0, left), y); g.lineTo(Math.min(W, right), y); }
      g.stroke();
    }
    // claims
    const me = this.state.me;
    const showNames = this.cam.zoom >= 0.25;
    const v = this.visibleChunkRect(0);
    g.textBaseline = 'middle'; g.textAlign = 'center';
    // Group visible plots by city so multi-plot cities render as one shape with one name.
    const cities = new Map<string, ClaimInfo[]>();
    for (const claim of this.state.claims.values()) {
      if (claim.cx < v.cx0 || claim.cx > v.cx1 || claim.cy < v.cy0 || claim.cy > v.cy1) continue;
      const list = cities.get(claim.ownerId);
      if (list) list.push(claim); else cities.set(claim.ownerId, [claim]);
    }
    for (const plots of cities.values()) {
      const first = plots[0];
      const own = !!me && first.ownerId === me.id;
      const st = claimStyle(first, own);
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity, w = 1, h = 1;
      // With a pixel image of the plot, tint only when fully zoomed out (a plot is then a few pixels wide and
      // the owner colour is what makes cities findable); without one (snapshot not loaded yet) fill as before.
      const tpxNow = this.tilePx() * this.dpr;
      for (const claim of plots) {
        this.drawnClaims.set(chunkKey(claim.cx, claim.cy), st);
        const x0 = this.dx(claim.cx * CHUNK), x1 = this.dx((claim.cx + 1) * CHUNK);
        const y0 = this.dy(claim.cy * CHUNK), y1 = this.dy((claim.cy + 1) * CHUNK);
        w = Math.max(1, x1 - x0); h = Math.max(1, y1 - y0);
        const hasImg = !!this.overviewMap.canvasFor(claim.cx, claim.cy);
        // at night the owner tint fades so the city lights (drawn underneath) show through
        const alpha = (!hasImg ? (st.abandoned ? 0.45 : own ? 0.7 : 0.5) : tpxNow < 0.5 ? 0.55 : tpxNow < 1 ? 0.3 : 0)
          * (1 - 0.85 * this.nightAtChunk(claim.cx, claim.cy));
        if (alpha <= 0) continue;
        g.fillStyle = withAlpha(st.color, alpha);
        g.fillRect(x0, y0, w, h);
        bx0 = Math.min(bx0, x0); by0 = Math.min(by0, y0); bx1 = Math.max(bx1, x1); by1 = Math.max(by1, y1);
      }
      if (w >= 6) {
        // outline only the outer edges of the city: white for yours, the owner's colour for everyone else
        g.strokeStyle = own ? '#ffffff' : st.abandoned ? 'rgba(255,255,255,0.5)' : withAlpha(st.color, 0.9);
        g.lineWidth = Math.max(1, Math.round((own ? 1.5 : 1) * this.dpr));
        g.setLineDash(st.abandoned ? [3, 3] : []);
        g.beginPath();
        for (const claim of plots) {
          const x0 = this.dx(claim.cx * CHUNK) + 0.5, x1 = this.dx((claim.cx + 1) * CHUNK) - 0.5;
          const y0 = this.dy(claim.cy * CHUNK) + 0.5, y1 = this.dy((claim.cy + 1) * CHUNK) - 0.5;
          if (!this.sameOwner(claim.cx, claim.cy - 1, claim.ownerId)) { g.moveTo(x0, y0); g.lineTo(x1, y0); }
          if (!this.sameOwner(claim.cx, claim.cy + 1, claim.ownerId)) { g.moveTo(x0, y1); g.lineTo(x1, y1); }
          if (!this.sameOwner(claim.cx - 1, claim.cy, claim.ownerId)) { g.moveTo(x0, y0); g.lineTo(x0, y1); }
          if (!this.sameOwner(claim.cx + 1, claim.cy, claim.ownerId)) { g.moveTo(x1, y0); g.lineTo(x1, y1); }
        }
        g.stroke(); g.setLineDash([]);
      }
      if (showNames && w >= 48 * this.dpr) {
        // one name per city, on the plot nearest the centre of the city's visible bounding box
        const mx = (bx0 + bx1) / 2, my = (by0 + by1) / 2;
        let best = first, bd = Infinity;
        for (const claim of plots) {
          const cxp = this.dx(claim.cx * CHUNK + CHUNK / 2), cyp = this.dy(claim.cy * CHUNK + CHUNK / 2);
          const d = Math.hypot(cxp - mx, cyp - my);
          if (d < bd) { bd = d; best = claim; }
        }
        const name = claimShortLabel(best);
        const span = Math.min(bx1 - bx0, 3 * w); // allow wider text across a multi-plot city
        const fs = clamp(Math.floor(span / 9), 9 * this.dpr, 14 * this.dpr);
        g.font = `${fs}px ui-monospace, Menlo, Consolas, monospace`;
        const tw = g.measureText(name).width;
        const cxp = this.dx(best.cx * CHUNK + CHUNK / 2), cyp = this.dy(best.cy * CHUNK + CHUNK / 2);
        // fits inside the plot, or inside the city's horizontal extent when the row is contiguous
        const rowW = plots.filter((c) => c.cy === best.cy).length * w;
        if (tw <= Math.max(w, rowW) - 6 * this.dpr) {
          g.fillStyle = 'rgba(0,0,0,0.7)';
          g.fillText(name, cxp + 1, cyp + 1);
          g.fillStyle = st.abandoned ? '#c0c0c0' : '#ffffff';
          g.fillText(name, cxp, cyp);
        }
      }
    }
    g.strokeStyle = 'rgba(255,255,255,0.3)';
    g.lineWidth = 1;
    g.strokeRect(left + 0.5, top + 0.5, right - left - 1, bottom - top - 1);
  }

  /** True if chunk (cx,cy) is claimed by `ownerId` (used to merge adjacent plots of one city). */
  /** Night lights at `lvl` darkness: the soft glow (light bleeding into the dark around the windows), then the crisp windows. */
  private drawNightImage(g: CanvasRenderingContext2D, im: NightImage, lvl: number, x: number, y: number, w: number, h: number): void {
    g.globalAlpha = lvl;
    g.imageSmoothingEnabled = true;
    g.drawImage(im.glow, x, y, w, h);
    g.imageSmoothingEnabled = false;
    g.drawImage(im.canvas, x, y, w, h);
  }

  /** How dark it is (0..1) at the centre of plot (cx, cy) right now. */
  private nightAtChunk(cx: number, cy: number): number {
    const lat = 90 - ((cy + 0.5) * CHUNK / WORLD_H) * 180, lon = ((cx + 0.5) * CHUNK / WORLD_W) * 360 - 180;
    return this.night.levelAt(lat, lon);
  }

  private sameOwner(cx: number, cy: number, ownerId: string): boolean {
    return this.state.claimAt(cx, cy)?.ownerId === ownerId;
  }

  // ---------- presence (other players) ----------
  /** Small dark chip with coloured text; (x, y) is the chip's top-left in device pixels. Returns its width. */
  private drawChip(g: CanvasRenderingContext2D, x: number, y: number, text: string, color: string): number {
    const d = this.dpr;
    g.font = `${Math.round(11 * d)}px ui-monospace, Menlo, Consolas, monospace`;
    g.textBaseline = 'middle'; g.textAlign = 'left';
    const padX = Math.round(5 * d), h = Math.round(16 * d);
    const tw = Math.ceil(g.measureText(text).width);
    const w = tw + padX * 2;
    g.fillStyle = 'rgba(8,10,16,0.78)';
    g.beginPath(); g.roundRect(x, y, w, h, Math.round(3 * d)); g.fill();
    g.strokeStyle = withAlpha(color, 0.6); g.lineWidth = 1;
    g.beginPath(); g.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, Math.round(3 * d)); g.stroke();
    g.fillStyle = color;
    g.fillText(text, x + padX, y + h / 2 + 0.5);
    return w;
  }

  private renderPresence(g: CanvasRenderingContext2D, now: number): void {
    this.drawnPresence.length = 0;
    const markers = this.presence.markers(now);
    if (!markers.length) return;
    const W = this.canvas.width, H = this.canvas.height, d = this.dpr;
    const onScreen = (px: number, py: number, m = 0) => px >= -m && py >= -m && px < W + m && py < H + m;
    const tp = this.tilePx() * d;
    if (this.isTileMode()) {
      for (const m of markers) {
        const label = presenceLabel(m.p);
        const color = m.p.color || '#ffffff';
        if (m.hasCursor && m.cx !== undefined && m.cy !== undefined) {
          // cursor: the tile the player is hovering (same footprint as our own cursor, one tile)
          const px = Math.round(((m.cx - this.cam.x) * this.tilePx() + this.cssW / 2) * d);
          const py = Math.round(((m.cy - this.cam.y) * this.tilePx() + this.cssH / 2) * d);
          if (onScreen(px, py, tp)) {
            g.fillStyle = withAlpha(color, 0.25);
            g.fillRect(px, py, Math.round(tp), Math.round(tp));
            g.strokeStyle = withAlpha(color, 0.95); g.lineWidth = Math.max(1, Math.round(1.5 * d));
            g.strokeRect(px + 0.5, py + 0.5, Math.round(tp) - 1, Math.round(tp) - 1);
            // pointer: a small arrow with its tip on the tile's top-left corner
            const s = Math.round(7 * d);
            g.fillStyle = color; g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = Math.max(1, Math.round(d));
            g.beginPath(); g.moveTo(px, py); g.lineTo(px + s * 1.6, py + s * 0.6); g.lineTo(px + s * 0.6, py + s * 1.6); g.closePath();
            g.fill(); g.stroke();
            this.drawChip(g, px + Math.round(12 * d), py - Math.round(18 * d), label, color);
            this.drawnPresence.push({ id: m.p.id, kind: 'cursor', x: px, y: py, label });
            continue;
          }
        }
        // no cursor on screen: soft dot at the player's camera centre if that is in view
        const px = Math.round(((m.x - this.cam.x) * this.tilePx() + this.cssW / 2) * d);
        const py = Math.round(((m.y - this.cam.y) * this.tilePx() + this.cssH / 2) * d);
        if (!onScreen(px, py)) continue;
        const r = Math.round(4 * d);
        g.fillStyle = 'rgba(0,0,0,0.6)'; g.beginPath(); g.arc(px, py, r + Math.round(1.5 * d), 0, Math.PI * 2); g.fill();
        g.fillStyle = withAlpha(color, 0.9); g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill();
        this.drawChip(g, px + r + Math.round(4 * d), py - Math.round(8 * d), label, color);
        this.drawnPresence.push({ id: m.p.id, kind: 'dot', x: px, y: py, label });
      }
    } else {
      // Overview: just a small dot at each player's camera centre with a name chip. (No viewport
      // rectangles: they cover large areas of the map and are distracting.)
      for (const m of markers) {
        const label = presenceLabel(m.p);
        const color = m.p.color || '#ffffff';
        const cxp = this.dx(m.x), cyp = this.dy(m.y);
        if (!onScreen(cxp, cyp)) continue;
        const r = Math.round(3.5 * d);
        g.fillStyle = 'rgba(0,0,0,0.6)'; g.beginPath(); g.arc(cxp, cyp, r + Math.round(1.5 * d), 0, Math.PI * 2); g.fill();
        g.fillStyle = withAlpha(color, 0.95); g.beginPath(); g.arc(cxp, cyp, r, 0, Math.PI * 2); g.fill();
        const chipY = clamp(cyp - Math.round(19 * d), Math.round(2 * d), H - Math.round(18 * d));
        const chipX = clamp(cxp + Math.round(8 * d), Math.round(2 * d), W - Math.round(60 * d));
        this.drawChip(g, chipX, chipY, label, color);
        this.drawnPresence.push({ id: m.p.id, kind: 'dot', x: cxp, y: cyp, label });
      }
    }
    if (this.animated && this.presence.animating(now)) this.invalidate();
  }

  // ---------- chunk canvases ----------
  private shouldBolt(v: number, own: boolean): boolean {
    return own && (v & ZONEBIT) !== 0 && (v & PWRBIT) === 0;
  }

  /** Blit sprite `frameId` (plus the power-bolt overlay for tile value `v`) at chunk index `idx`. */
  private drawFrame(cc: ChunkCanvas, v: number, idx: number, frameId: number, own: boolean): void {
    const tx = (idx % CHUNK) * TILE_PX, ty = Math.floor(idx / CHUNK) * TILE_PX;
    drawTile(cc.g, this.sheet, frameId, tx, ty);
    if (this.shouldBolt(v, own)) drawTile(cc.g, this.sheet, LIGHTNINGBOLT, tx, ty);
  }

  /** Draw the stored tile at `idx` (first frame) and re-evaluate its animation membership. */
  private drawTileAt(cc: ChunkCanvas, tiles: Uint16Array, idx: number, own: boolean): void {
    const v = tiles[idx];
    this.drawFrame(cc, v, idx, v & LOMASK, own);
    if (isAnimatedTile(v)) { cc.anim.add(idx); cc.frame.set(idx, v & LOMASK); }
    else if (cc.anim.size) { cc.anim.delete(idx); cc.frame.delete(idx); }
  }

  private buildChunkCanvas(key: string, cx: number, cy: number, tiles: Uint16Array): ChunkCanvas {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = CHUNK_PX;
    const g = canvas.getContext('2d', { alpha: false })!;
    g.imageSmoothingEnabled = false;
    const cc: ChunkCanvas = { key, canvas, g, lastUse: this.frame, anim: new Set(), frame: new Map() };
    const own = this.state.ownsChunk(cx, cy);
    for (let i = 0; i < CHUNK * CHUNK; i++) this.drawTileAt(cc, tiles, i, own);
    this.chunkCanvases.set(key, cc);
    return cc;
  }

  private processDirty(): void {
    if (this.map.dirty.size === 0) return;
    const dirty = this.map.takeDirty();
    for (const [key, idxs] of dirty) {
      this.nightLights?.markDirty(key);
      const cc = this.chunkCanvases.get(key);
      if (!cc) continue;
      if (idxs.length && idxs[0] === DIRTY_ALL) { this.chunkCanvases.delete(key); continue; }
      const { cx, cy } = parseChunkKey(key);
      const tiles = this.map.getChunk(cx, cy);
      if (!tiles) { this.chunkCanvases.delete(key); continue; }
      const own = this.state.ownsChunk(cx, cy);
      for (const idx of idxs) this.drawTileAt(cc, tiles, idx, own);
    }
  }

  /** Re-render chunk canvases whose ownership changed (power-bolt overlay depends on it). */
  rebuildChunk(cx: number, cy: number): void { this.chunkCanvases.delete(chunkKey(cx, cy)); this.invalidate(); }

  private evictCanvases(): void {
    if (this.chunkCanvases.size <= MAX_CHUNK_CANVASES) return;
    const ccx = this.cam.x / CHUNK, ccy = this.cam.y / CHUNK;
    const entries = [...this.chunkCanvases.entries()]
      .filter(([, cc]) => cc.lastUse !== this.frame)
      .map(([key, cc]) => { const { cx, cy } = parseChunkKey(key); return { key, cc, d: (cx + 0.5 - ccx) ** 2 + (cy + 0.5 - ccy) ** 2 }; })
      .sort((a, b) => b.d - a.d);
    const n = this.chunkCanvases.size - MAX_CHUNK_CANVASES;
    for (let i = 0; i < n && i < entries.length; i++) this.chunkCanvases.delete(entries[i].key);
  }

  get chunkCanvasCount(): number { return this.chunkCanvases.size; }
  /** Test hook: the offscreen canvas for a chunk, if built. */
  chunkCanvasFor(cx: number, cy: number): HTMLCanvasElement | undefined { return this.chunkCanvases.get(chunkKey(cx, cy))?.canvas; }
}
