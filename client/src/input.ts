// Mouse / touch / keyboard handling for the map canvas.
import type { ToolId } from '@globalcity/shared';
import { CHUNK, LOMASK, LHPOWER, LVPOWER10, TOOLS, TOOL_ORDER, WORLD_W, inWorld, isDirt, isRubble, isTree } from '@globalcity/shared';
import type { Actions } from './actions.ts';
import type { Renderer } from './renderer.ts';
import type { AppState } from './state.ts';

export const PAINT_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>(['road', 'rail', 'wire', 'bulldozer', 'park']);
/** Line tools whose drags lock to one axis (hold Shift for freeform). */
export const LINE_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>(['road', 'rail', 'wire']);
/** Zone tools: a drag lays a zone in every 3x3 cell it crosses, on a grid anchored at the drag start. */
export const ZONE_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>(['residential', 'commercial', 'industrial']);
const ZONE = 3;
/** Tiles moved from the drag start before the axis locks. */
const AXIS_LOCK_TILES = 2;

export interface InputHooks {
  /** called when the user clicks with the query tool; (cssX, cssY) is where to show the popover */
  onQueryClick(cssX: number, cssY: number): void;
  /** a plane or ship was clicked (query tool, or anywhere on the world map) */
  onVehicleClick(v: NonNullable<ReturnType<Renderer['pickVehicle']>>, cssX: number, cssY: number): void;
  /** right-click in query mode: turn off the map view (overlay); false when none was on */
  onClearOverlay(): boolean;
  /** called on any gesture that should dismiss popovers */
  onInteract(): void;
  /** touch: a build tool was aimed at a tile (null = cleared); the UI shows a confirm bar */
  onTouchTarget(tile: { x: number; y: number } | null): void;
  /** touch: a drawn line or area waits for confirmation (null = cleared); the UI shows a confirm bar */
  onTouchPlan(plan: TouchPlan | null): void;
}

/** A touch drawing waiting to be confirmed: what it would build and roughly what it costs. */
export interface TouchPlan { tool: ToolId; count: number; cost: number }

interface PointerInfo { x: number; y: number; sx: number; sy: number; button: number; type: string }
type Mode = 'none' | 'maybe-click' | 'maybe-draw' | 'draw' | 'pan' | 'paint' | 'pinch';

const DRAG_THRESHOLD = 4;
/** css px a finger must move (with a paint or zone tool) before a touch becomes a drawing */
const TOUCH_DRAW_THRESHOLD = 8;
const BUILD_INTERVAL_MS = 25;

export class Input {
  private pointers = new Map<number, PointerInfo>();
  private mode: Mode = 'none';
  private spaceHeld = false;
  private lastPaint: { x: number; y: number } | null = null;
  /** drag start tile and the locked axis for line tools ('h' / 'v' / null = not decided yet) */
  private paintStart: { x: number; y: number } | null = null;
  private axis: 'h' | 'v' | null = null;
  private pinch: { dist: number; zoom: number } | null = null;
  private wheelAcc = 0;
  private lastWheelStep = 0;
  private buildQueue: { tool: ToolId; x: number; y: number }[] = [];
  /** touch drawing: the tiles drawn so far (or waiting for confirmation), each with whether it can be built */
  private plan: { tool: ToolId; tiles: { x: number; y: number; ok: boolean }[] } | null = null;
  private planKeys = new Set<number>();
  /** a finger is drawing right now (a second finger turns it into a pinch and drops the drawing) */
  private drafting = false;
  private buildTimer: ReturnType<typeof setTimeout> | null = null;
  private lastBuildAt = 0;
  private hotkeys = new Map<string, ToolId>();

  constructor(
    readonly renderer: Renderer,
    readonly state: AppState,
    readonly actions: Actions,
    readonly hooks: InputHooks,
  ) {
    for (const id of TOOL_ORDER) this.hotkeys.set(TOOLS[id].hotkey.toLowerCase(), id);
    this.attach();
  }

  private attach(): void {
    const c = this.renderer.canvas;
    c.style.touchAction = 'none';
    c.addEventListener('pointerdown', this.onPointerDown);
    c.addEventListener('pointermove', this.onPointerMove);
    c.addEventListener('pointerup', this.onPointerUp);
    c.addEventListener('pointercancel', this.onPointerUp);
    // Mouse leaving the canvas clears the hover cursor; a finger lifting also fires pointerleave,
    // but on touch the cursor is the aimed footprint and must stay until confirmed or cancelled.
    c.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch' && this.pointers.size === 0) this.renderer.setHover(null); });
    c.addEventListener('wheel', this.onWheel, { passive: false });
    c.addEventListener('dblclick', this.onDblClick);
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => { this.spaceHeld = false; });
  }

  private tileAt(cssX: number, cssY: number): { x: number; y: number } {
    const p = this.renderer.screenToTile(cssX, cssY);
    return { x: Math.floor(p.x), y: Math.floor(p.y) };
  }

  private updateHover(cssX: number, cssY: number): void {
    if (!this.renderer.isTileMode()) { this.renderer.setHover(null); return; }
    const t = this.tileAt(cssX, cssY);
    this.renderer.setHover(inWorld(t.x, t.y) ? t : null);
  }

  private onPointerDown = (e: PointerEvent): void => {
    const c = this.renderer.canvas;
    try { c.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    this.renderer.syncSize(); // a stale canvas size would put this tap on the wrong tile
    this.hooks.onInteract();
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, button: e.button, type: e.pointerType });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: this.renderer.cam.zoom };
      this.mode = 'pinch';
      if (this.drafting) this.clearPlan(); // two fingers move the map: the drawing just started is dropped
      this.flushPaint();
      return;
    }
    if (this.pointers.size > 2) return;
    const tool = this.state.tool;
    const panButton = e.button === 1 || e.button === 2;
    if (e.pointerType === 'touch' && this.renderer.isTileMode() && (PAINT_TOOLS.has(tool) || ZONE_TOOLS.has(tool))) {
      // touch with a paint or zone tool: one finger draws (a tap aims one tile), two fingers move the map
      this.mode = 'maybe-draw';
      this.paintStart = this.tileAt(e.clientX, e.clientY);
      return;
    }
    if (panButton || this.spaceHeld || !this.renderer.isTileMode() || e.pointerType === 'touch' || tool === 'query') {
      // middle button / space: pan at once; right button: pan once dragged, a plain right-click picks the query tool
      this.mode = e.button === 1 || this.spaceHeld ? 'pan' : 'maybe-click';
      return;
    }
    // left button, tile mode, build tool
    this.updateHover(e.clientX, e.clientY);
    const t = this.tileAt(e.clientX, e.clientY);
    if (!inWorld(t.x, t.y)) { this.mode = 'none'; return; }
    if (PAINT_TOOLS.has(tool) || ZONE_TOOLS.has(tool)) {
      this.mode = 'paint';
      this.lastPaint = t;
      this.paintStart = t; this.axis = null;
      this.enqueueBuild(t.x, t.y, true);
    } else {
      this.mode = 'none';
      this.actions.build(tool, t.x, t.y);
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    if (!p) { this.updateHover(e.clientX, e.clientY); return; }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (this.mode === 'pinch' && this.pointers.size >= 2 && this.pinch) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      this.renderer.zoomAround(mx, my, this.pinch.zoom * (dist / this.pinch.dist));
      // pan by half the moved pointer's delta (midpoint movement)
      this.renderer.panBy(dx / 2, dy / 2);
      return;
    }
    if (this.mode === 'maybe-click') {
      if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > DRAG_THRESHOLD) this.mode = 'pan';
    }
    if (this.mode === 'maybe-draw') {
      if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) <= TOUCH_DRAW_THRESHOLD) return;
      // a new drawing replaces an aimed tile or an unconfirmed drawing
      this.renderer.setHover(null);
      this.hooks.onTouchTarget(null);
      this.clearPlan();
      this.mode = 'draw';
      this.drafting = true;
      this.plan = { tool: this.state.tool, tiles: [] };
      this.lastPaint = this.paintStart;
      this.addToPlan(this.paintStart!.x, this.paintStart!.y);
    }
    if (this.mode === 'draw') { this.extendPlan(this.tileAt(e.clientX, e.clientY)); return; }
    if (this.mode === 'pan') {
      this.renderer.panBy(dx, dy);
      this.updateHover(e.clientX, e.clientY);
      return;
    }
    this.updateHover(e.clientX, e.clientY);
    if (this.mode === 'paint' && this.lastPaint) {
      const zone = ZONE_TOOLS.has(this.state.tool);
      const t = zone ? this.snapToZone(this.tileAt(e.clientX, e.clientY)) : this.lockToAxis(this.tileAt(e.clientX, e.clientY), e.shiftKey);
      if (this.paintStart && (zone || (LINE_TOOLS.has(this.state.tool) && !e.shiftKey))) this.renderer.setHover(t);
      if (t.x !== this.lastPaint.x || t.y !== this.lastPaint.y) {
        this.paintLine(this.lastPaint, t, zone ? ZONE : 1, (x, y) => this.enqueueBuild(x, y, false));
        this.lastPaint = t;
      }
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    try { this.renderer.canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (this.mode === 'pinch') {
      if (this.pointers.size < 2) { this.pinch = null; this.mode = this.pointers.size === 1 ? 'pan' : 'none'; }
      return;
    }
    if (this.mode === 'maybe-draw') {
      // no drag: a tap. With a drawing waiting it only cancels that; otherwise it aims (or builds) one tile.
      if (this.plan) { this.clearPlan(); this.mode = 'none'; this.paintStart = null; return; }
      this.mode = 'maybe-click';
    }
    if (this.mode === 'draw') {
      // the drawing stays on the map until the player confirms or cancels it
      this.drafting = false;
      const plan = this.plan!, ok = plan.tiles.filter((t) => t.ok).length;
      this.hooks.onTouchPlan({ tool: plan.tool, count: ok, cost: ok * TOOLS[plan.tool].cost });
    }
    if (this.mode === 'maybe-click' && p && p.button === 2 && this.state.tool !== 'query') {
      // right-click drops the build tool and returns to query mode (a right-drag still pans)
      this.state.setTool('query');
      this.renderer.setHover(null);
    } else if (this.mode === 'maybe-click' && p && p.button === 2 && this.hooks.onClearOverlay()) {
      // right-click in query mode with a map view on: back to the normal map
    } else if (this.mode === 'maybe-click' && p && (this.state.tool === 'query' || !this.renderer.isTileMode())
      && this.renderer.pickVehicle(e.clientX, e.clientY)) {
      this.hooks.onVehicleClick(this.renderer.pickVehicle(e.clientX, e.clientY)!, e.clientX, e.clientY);
    } else if (this.mode === 'maybe-click' && p && this.renderer.isTileMode()) {
      const t = this.tileAt(e.clientX, e.clientY);
      if (inWorld(t.x, t.y)) {
        if (this.state.tool === 'query' || p.button !== 0) {
          if (this.actions.query(t.x, t.y)) this.hooks.onQueryClick(e.clientX, e.clientY);
        } else if (p.type === 'touch') {
          // Two-tap placement: the finger hides the tile, so the first tap only aims the footprint
          // cursor; tapping the same tile again (or the Build button) commits.
          const h = this.renderer.hover;
          if (h && h.x === t.x && h.y === t.y) {
            this.actions.build(this.state.tool, t.x, t.y);
            this.renderer.setHover(null);
            this.hooks.onTouchTarget(null);
          } else {
            this.renderer.setHover(t);
            this.hooks.onTouchTarget(t);
          }
        }
      }
    }
    if (this.mode === 'paint') this.flushPaint();
    // (a pinch always ends through 'pan' or returns above); after a touch paint the marker goes too
    const wasGesture = this.mode === 'pan' || this.mode === 'paint' || this.mode === 'draw';
    this.mode = 'none';
    this.lastPaint = null;
    this.paintStart = null; this.axis = null;
    if (e.pointerType === 'touch' && wasGesture) { this.renderer.setHover(null); this.hooks.onTouchTarget(null); }
  };

  /**
   * Line tools: keep the drag on one axis. Until the pointer is AXIS_LOCK_TILES from the start it follows
   * the dominant direction; then that axis locks until release. Shift (or other tools) = freeform.
   */
  private lockToAxis(t: { x: number; y: number }, free: boolean): { x: number; y: number } {
    const s = this.paintStart;
    if (!s || free || !LINE_TOOLS.has(this.state.tool)) return t;
    const dx = t.x - s.x, dy = t.y - s.y;
    let axis = this.axis;
    if (!axis) {
      axis = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
      if (Math.max(Math.abs(dx), Math.abs(dy)) >= AXIS_LOCK_TILES) this.axis = axis;
    }
    return axis === 'h' ? { x: t.x, y: s.y } : { x: s.x, y: t.y };
  }

  /** Zone tools: the centre of the 3x3 grid cell under t, the grid lined up with the drag start. */
  private snapToZone(t: { x: number; y: number }): { x: number; y: number } {
    const s = this.paintStart;
    if (!s) return t;
    return { x: s.x + ZONE * Math.round((t.x - s.x) / ZONE), y: s.y + ZONE * Math.round((t.y - s.y) / ZONE) };
  }

  /** A zone centred at (x, y) would fit: every tile in a plot we own, and clear (as the server checks it). */
  private zoneFits(x: number, y: number): boolean {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const tx = x + dx, ty = y + dy;
      if (!inWorld(tx, ty) || !this.state.ownsChunk(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK))) return false;
      const v = this.renderer.map.get(tx, ty);
      if (v === undefined) return false;
      const id = v & LOMASK;
      if (!isDirt(v) && !isTree(v) && !isRubble(v) && !(id >= LHPOWER && id <= LVPOWER10)) return false;
    }
    return true;
  }

  /** Commit the touch drawing, or else the touch-aimed footprint (the UI's Build button). */
  confirmTouch(): void {
    if (this.plan) {
      for (const t of this.plan.tiles) if (t.ok) this.buildQueue.push({ tool: this.plan.tool, x: t.x, y: t.y });
      this.clearPlan();
      this.drainBuilds();
      return;
    }
    const h = this.renderer.hover;
    if (!h || !this.renderer.isTileMode()) return;
    this.actions.build(this.state.tool, h.x, h.y);
    this.renderer.setHover(null);
    this.hooks.onTouchTarget(null);
  }
  clearTouchTarget(): void { this.clearPlan(); this.renderer.setHover(null); this.hooks.onTouchTarget(null); }

  // ---------- touch drawing ----------
  private clearPlan(): void {
    this.drafting = false;
    if (!this.plan) return;
    this.plan = null;
    this.planKeys.clear();
    this.renderer.setPlan(null);
    this.hooks.onTouchPlan(null);
  }

  /** Grow the drawing to the finger at t: road, rail and power lines go straight from the start along the
   *  finger's main direction (redrawn as it moves); zones follow the finger on their 3x3 grid, parks and the
   *  bulldozer tile by tile. */
  private extendPlan(t: { x: number; y: number }): void {
    const plan = this.plan, s = this.paintStart;
    if (!plan || !s || !this.lastPaint) return;
    if (LINE_TOOLS.has(plan.tool)) {
      const end = Math.abs(t.x - s.x) >= Math.abs(t.y - s.y) ? { x: t.x, y: s.y } : { x: s.x, y: t.y };
      plan.tiles = []; this.planKeys.clear();
      this.addToPlan(s.x, s.y);
      this.paintLine(s, end, 1, (x, y) => this.addToPlan(x, y));
    } else {
      const zone = ZONE_TOOLS.has(plan.tool);
      const to = zone ? this.snapToZone(t) : t;
      if (to.x === this.lastPaint.x && to.y === this.lastPaint.y) return;
      this.paintLine(this.lastPaint, to, zone ? ZONE : 1, (x, y) => this.addToPlan(x, y));
      this.lastPaint = to;
    }
    this.renderer.setPlan(plan);
  }

  private addToPlan(x: number, y: number): void {
    const plan = this.plan;
    if (!plan || !inWorld(x, y) || this.planKeys.has(y * WORLD_W + x)) return;
    this.planKeys.add(y * WORLD_W + x);
    const owned = this.state.ownsChunk(Math.floor(x / CHUNK), Math.floor(y / CHUNK));
    plan.tiles.push({ x, y, ok: owned && (!ZONE_TOOLS.has(plan.tool) || this.zoneFits(x, y)) });
    this.renderer.setPlan(plan);
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.hooks.onInteract();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
    this.wheelAcc += e.deltaY * unit;
    const now = performance.now();
    if (Math.abs(this.wheelAcc) >= 40 && now - this.lastWheelStep > 60) {
      this.renderer.zoomStep(this.wheelAcc < 0 ? 1 : -1, e.clientX, e.clientY);
      this.wheelAcc = 0;
      this.lastWheelStep = now;
      this.updateHover(e.clientX, e.clientY);
    } else if (Math.abs(this.wheelAcc) >= 40) {
      this.wheelAcc = 0;
    }
  };

  private onDblClick = (e: MouseEvent): void => {
    e.preventDefault();
    if (this.renderer.isTileMode()) return;
    const t = this.renderer.screenToTile(e.clientX, e.clientY);
    if (!inWorld(Math.floor(t.x), Math.floor(t.y))) return;
    this.actions.flyToChunk(Math.floor(t.x / CHUNK), Math.floor(t.y / CHUNK), 1, 600);
  };

  private isTyping(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === ' ') { this.spaceHeld = true; e.preventDefault(); return; }
    if (key === 'escape') { this.state.setTool('query'); this.hooks.onInteract(); return; }
    const tool = this.hotkeys.get(key);
    if (tool) { this.state.setTool(tool); return; }
    const step = 64;
    switch (key) {
      case 'arrowleft': case 'a': this.renderer.panBy(step, 0); break;
      case 'arrowright': case 'd': this.renderer.panBy(-step, 0); break;
      case 'arrowup': case 'w': this.renderer.panBy(0, step); break;
      case 'arrowdown': case 's': this.renderer.panBy(0, -step); break;
      case '+': case '=': this.renderer.zoomStep(1); break;
      case '-': case '_': this.renderer.zoomStep(-1); break;
      case 'h': this.renderer.showWorld(); break;
      case 'g': this.actions.goToMyCity(); break;
      default: return;
    }
    e.preventDefault();
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === ' ') this.spaceHeld = false;
  };

  // ---------- painting ----------
  /** Paint from a to b. `step` > 1 walks a grid of that spacing anchored at the drag start (zone cells). */
  private paintLine(a: { x: number; y: number }, b: { x: number; y: number }, step: number, visit: (x: number, y: number) => void): void {
    // Bresenham (in grid cells) so fast drags do not skip tiles
    const o = this.paintStart ?? a;
    const ax = (a.x - o.x) / step, ay = (a.y - o.y) / step;
    let x0 = ax, y0 = ay;
    const x1 = (b.x - o.x) / step, y1 = (b.y - o.y) / step;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let guard = 0;
    while (guard++ < 4096) {
      if (x0 !== ax || y0 !== ay) visit(o.x + x0 * step, o.y + y0 * step);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  private enqueueBuild(x: number, y: number, first: boolean): void {
    if (!inWorld(x, y)) return;
    // while dragging only paint on chunks we own, and zones only where they fit (the first click goes
    // through so the server can explain)
    if (!first && !this.state.ownsChunk(Math.floor(x / CHUNK), Math.floor(y / CHUNK))) return;
    if (!first && ZONE_TOOLS.has(this.state.tool) && (!this.zoneFits(x, y) || this.state.funds < TOOLS[this.state.tool].cost)) return;
    this.buildQueue.push({ tool: this.state.tool, x, y });
    this.drainBuilds();
  }

  private drainBuilds(): void {
    if (this.buildTimer) return;
    const now = performance.now();
    const wait = Math.max(0, this.lastBuildAt + BUILD_INTERVAL_MS - now);
    this.buildTimer = setTimeout(() => {
      this.buildTimer = null;
      const next = this.buildQueue.shift();
      if (next) {
        this.lastBuildAt = performance.now();
        if (PAINT_TOOLS.has(next.tool) || ZONE_TOOLS.has(next.tool)) this.actions.build(next.tool, next.x, next.y);
      }
      if (this.buildQueue.length) this.drainBuilds();
    }, wait);
  }

  private flushPaint(): void { /* queued builds keep draining; nothing else to do */ }
}
