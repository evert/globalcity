// Canvas 2D renderer: tile mode (chunk canvases blitted from the sprite sheet) and
// overview mode (minimap + claim rectangles). Redraws only when invalidated.
import {
  CHUNK, CHUNKS_X, CHUNKS_Y, WORLD_W, WORLD_H, TILE_PX, MAX_SUBSCRIBED_CHUNKS,
  LOMASK, ZONEBIT, PWRBIT, LIGHTNINGBOLT, FIRE, LASTFIRE, TOOLS, footprintOrigin, chunkKey, parseChunkKey, clamp, inWorld,
} from '@globalcity/shared';
import type { ClaimInfo } from '@globalcity/shared';
import type { SpriteSheet, Minimap } from './assets.ts';
import { drawTile } from './assets.ts';
import { TileMap, DIRTY_ALL } from './map.ts';
import type { AppState, ClaimIdle } from './state.ts';
import { claimIdleState, claimLabel, claimShortLabel } from './state.ts';
import { Emitter } from './emitter.ts';
import { PresenceTracker, presenceLabel, PRESENCE_STALE_MS } from './presence.ts';

export interface Camera { x: number; y: number; zoom: number }
export interface TilePos { x: number; y: number }
export interface ChunkRect { cx0: number; cy0: number; cx1: number; cy1: number }

export const TILE_MODE_ZOOM = 0.5;
export const MAX_ZOOM = 3;
const CHUNK_PX = CHUNK * TILE_PX; // 1024
const MAX_CHUNK_CANVASES = 120;
const CHUNK_BUILD_BUDGET = 8; // chunk canvases built per frame
const SETTLE_MS = 150;
export const FIRE_FRAME_MS = 250;
export const FIRE_FRAMES = LASTFIRE - FIRE + 1; // 8
const FLASH_MS = 2000;

type RendererEvents = { camera: Camera; settle: Camera; hover: TilePos | null };

/** `fire`: tile indices in this chunk currently drawn as a fire frame (animated every FIRE_FRAME_MS while on screen). */
interface ChunkCanvas { key: string; canvas: HTMLCanvasElement; g: CanvasRenderingContext2D; lastUse: number; fire: Set<number> }

export function isFireTile(v: number): boolean { const id = v & LOMASK; return id >= FIRE && id <= LASTFIRE; }

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
export interface DrawnPresence { id: string; kind: 'cursor' | 'dot' | 'rect'; x: number; y: number; label: string }

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
  /** fire animation: current frame offset, chunk canvases with burning tiles blitted in the last frame, pending timer */
  fireStep = 0;
  private visibleFire: ChunkCanvas[] = [];
  private fireTimer: ReturnType<typeof setTimeout> | null = null;
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
    this.setSize(window.innerWidth, window.innerHeight, Math.min(2, window.devicePixelRatio || 1));
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
    this.visibleFire.length = 0;
    this.drawnClaims.clear();
    if (this.isTileMode()) this.renderTiles(g); else this.renderOverview(g);
    this.renderPresence(g, now);
    this.renderFlash(g, now);
    this.evictCanvases();
    if (this.pendingBuilds > 0) this.invalidate();
    if (this.visibleFire.length && this.animated) this.scheduleFire();
  }

  // ---------- fire animation ----------
  /** True when at least one burning tile was blitted in the last frame. */
  get fireVisible(): boolean { return this.visibleFire.length > 0; }

  private scheduleFire(): void {
    if (this.fireTimer) return;
    this.fireTimer = setTimeout(() => { this.fireTimer = null; this.stepFire(); }, FIRE_FRAME_MS);
  }

  /** Advance the fire animation one frame: redraw only the burning tiles of on-screen chunks, then invalidate. */
  stepFire(): void {
    if (!this.visibleFire.length) return; // nothing burning on screen: costs nothing
    this.fireStep = (this.fireStep + 1) % FIRE_FRAMES;
    for (const cc of this.visibleFire) {
      if (this.chunkCanvases.get(cc.key) !== cc) continue; // evicted or rebuilt since the last frame
      const { cx, cy } = parseChunkKey(cc.key);
      const tiles = this.map.getChunk(cx, cy);
      if (!tiles) continue;
      const own = this.state.ownsChunk(cx, cy);
      for (const idx of cc.fire) this.drawTileAt(cc, tiles, idx, own);
    }
    this.invalidate();
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

  private renderTiles(g: CanvasRenderingContext2D): void {
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
          if (cc.fire.size) this.visibleFire.push(cc);
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
    // 2. chunk borders + claims
    g.lineWidth = Math.max(1, Math.round(this.dpr));
    const me = this.state.me;
    const labelFont = `${Math.round(12 * this.dpr)}px ui-monospace, Menlo, Consolas, monospace`;
    for (let cy = r.cy0; cy <= r.cy1; cy++) {
      for (let cx = r.cx0; cx <= r.cx1; cx++) {
        const x0 = this.dx(cx * CHUNK), x1 = this.dx((cx + 1) * CHUNK);
        const y0 = this.dy(cy * CHUNK), y1 = this.dy((cy + 1) * CHUNK);
        const claim = this.state.claimAt(cx, cy);
        if (claim) {
          const own = !!me && claim.ownerId === me.id;
          const st = claimStyle(claim, own);
          this.drawnClaims.set(chunkKey(cx, cy), st);
          g.fillStyle = st.abandoned ? 'rgba(120,120,120,0.38)' : withAlpha(st.color, own ? 0.28 : 0.18);
          g.fillRect(x0, y0, x1 - x0, y1 - y0);
          if (st.abandoned) {
            // grey dashed border: decaying, soon claimable again
            g.strokeStyle = 'rgba(210,210,210,0.85)';
            g.lineWidth = Math.max(2, Math.round(2 * this.dpr));
            g.setLineDash([Math.round(10 * this.dpr), Math.round(7 * this.dpr)]);
            g.strokeRect(x0 + 1, y0 + 1, x1 - x0 - 2, y1 - y0 - 2);
            g.setLineDash([]);
          } else {
            g.strokeStyle = withAlpha(st.color, own ? 0.95 : 0.7);
            g.lineWidth = own ? Math.max(2, Math.round(2 * this.dpr)) : Math.max(1, Math.round(this.dpr));
            g.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);
          }
          if (x1 - x0 >= 90 * this.dpr) {
            // label in the top-left of the *visible* part of the chunk (and out from under the toolbar / top bar),
            // so partially scrolled plots stay identifiable
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
    const size = tool.size;
    let ok = this.state.funds >= tool.cost;
    if (tool.id !== 'query') {
      for (let y = y0; y < y0 + size && ok; y++) for (let x = x0; x < x0 + size; x++) {
        if (!inWorld(x, y) || !this.state.ownsChunk(Math.floor(x / CHUNK), Math.floor(y / CHUNK))) { ok = false; break; }
      }
    }
    const px0 = this.dx(x0), py0 = this.dy(y0), px1 = this.dx(x0 + size), py1 = this.dy(y0 + size);
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
    for (const claim of this.state.claims.values()) {
      if (claim.cx < v.cx0 || claim.cx > v.cx1 || claim.cy < v.cy0 || claim.cy > v.cy1) continue;
      const x0 = this.dx(claim.cx * CHUNK), x1 = this.dx((claim.cx + 1) * CHUNK);
      const y0 = this.dy(claim.cy * CHUNK), y1 = this.dy((claim.cy + 1) * CHUNK);
      const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
      const own = !!me && claim.ownerId === me.id;
      const st = claimStyle(claim, own);
      this.drawnClaims.set(chunkKey(claim.cx, claim.cy), st);
      g.fillStyle = withAlpha(st.color, st.abandoned ? 0.45 : own ? 0.7 : 0.5);
      g.fillRect(x0, y0, w, h);
      if (own) { g.strokeStyle = '#ffffff'; g.lineWidth = Math.max(1, Math.round(this.dpr)); g.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1); }
      else if (st.abandoned && w >= 6) {
        g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1;
        g.setLineDash([3, 3]); g.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1); g.setLineDash([]);
      }
      if (showNames && w >= 48 * this.dpr) {
        const name = claimShortLabel(claim);
        const fs = clamp(Math.floor(w / 9), 9 * this.dpr, 14 * this.dpr);
        g.font = `${fs}px ui-monospace, Menlo, Consolas, monospace`;
        const tw = g.measureText(name).width;
        if (tw <= w - 6 * this.dpr) {
          g.fillStyle = 'rgba(0,0,0,0.7)';
          g.fillText(name, (x0 + x1) / 2 + 1, (y0 + y1) / 2 + 1);
          g.fillStyle = st.abandoned ? '#c0c0c0' : '#ffffff';
          g.fillText(name, (x0 + x1) / 2, (y0 + y1) / 2);
        }
      }
    }
    g.strokeStyle = 'rgba(255,255,255,0.3)';
    g.lineWidth = 1;
    g.strokeRect(left + 0.5, top + 0.5, right - left - 1, bottom - top - 1);
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
        const r = Math.round(7 * d);
        g.fillStyle = withAlpha(color, 0.18); g.beginPath(); g.arc(px, py, r * 2, 0, Math.PI * 2); g.fill();
        g.fillStyle = withAlpha(color, 0.75); g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill();
        this.drawChip(g, px + r + Math.round(4 * d), py - Math.round(8 * d), label, color);
        this.drawnPresence.push({ id: m.p.id, kind: 'dot', x: px, y: py, label });
      }
    } else {
      for (const m of markers) {
        const label = presenceLabel(m.p);
        const color = m.p.color || '#ffffff';
        const { w, h } = PresenceTracker.viewSize(m.p.zoom);
        const x0 = this.dx(m.x - w / 2), x1 = this.dx(m.x + w / 2), y0 = this.dy(m.y - h / 2), y1 = this.dy(m.y + h / 2);
        if (x1 < 0 || y1 < 0 || x0 >= W || y0 >= H) continue;
        const cxp = this.dx(m.x), cyp = this.dy(m.y);
        const huge = x1 - x0 > W * 0.9 && y1 - y0 > H * 0.9; // zoomed all the way out: a rectangle would be the whole screen
        if (!huge) {
          g.strokeStyle = withAlpha(color, 0.9); g.lineWidth = Math.max(1, Math.round(d));
          g.strokeRect(x0 + 0.5, y0 + 0.5, Math.max(2, x1 - x0 - 1), Math.max(2, y1 - y0 - 1));
          g.fillStyle = withAlpha(color, 0.08); g.fillRect(x0, y0, x1 - x0, y1 - y0);
        }
        g.fillStyle = withAlpha(color, 0.9); g.beginPath(); g.arc(cxp, cyp, Math.round(3 * d), 0, Math.PI * 2); g.fill();
        // chip above the rectangle, kept inside the canvas
        const chipY = clamp((huge ? cyp : y0) - Math.round(19 * d), Math.round(2 * d), H - Math.round(18 * d));
        const chipX = clamp(huge ? cxp + Math.round(8 * d) : x0, Math.round(2 * d), W - Math.round(60 * d));
        this.drawChip(g, chipX, chipY, label, color);
        this.drawnPresence.push({ id: m.p.id, kind: 'rect', x: cxp, y: cyp, label });
      }
    }
    if (this.animated && this.presence.animating(now)) this.invalidate();
  }

  // ---------- chunk canvases ----------
  private shouldBolt(v: number, own: boolean): boolean {
    return own && (v & ZONEBIT) !== 0 && (v & PWRBIT) === 0;
  }

  /** Sprite id actually drawn for a tile value (fire tiles cycle through FIRE..LASTFIRE with fireStep). */
  frameFor(v: number): number {
    const id = v & LOMASK;
    return isFireTile(v) ? FIRE + ((id - FIRE + this.fireStep) % FIRE_FRAMES) : id;
  }

  private drawTileAt(cc: ChunkCanvas, tiles: Uint16Array, idx: number, own: boolean): void {
    const v = tiles[idx];
    const tx = (idx % CHUNK) * TILE_PX, ty = Math.floor(idx / CHUNK) * TILE_PX;
    drawTile(cc.g, this.sheet, this.frameFor(v), tx, ty);
    if (this.shouldBolt(v, own)) drawTile(cc.g, this.sheet, LIGHTNINGBOLT, tx, ty);
    if (isFireTile(v)) cc.fire.add(idx); else if (cc.fire.size) cc.fire.delete(idx);
  }

  private buildChunkCanvas(key: string, cx: number, cy: number, tiles: Uint16Array): ChunkCanvas {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = CHUNK_PX;
    const g = canvas.getContext('2d', { alpha: false })!;
    g.imageSmoothingEnabled = false;
    const cc: ChunkCanvas = { key, canvas, g, lastUse: this.frame, fire: new Set() };
    const own = this.state.ownsChunk(cx, cy);
    for (let i = 0; i < CHUNK * CHUNK; i++) this.drawTileAt(cc, tiles, i, own);
    this.chunkCanvases.set(key, cc);
    return cc;
  }

  private processDirty(): void {
    if (this.map.dirty.size === 0) return;
    const dirty = this.map.takeDirty();
    for (const [key, idxs] of dirty) {
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
