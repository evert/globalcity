// Mouse / touch / keyboard handling for the map canvas.
import type { ToolId } from '@globalcity/shared';
import { CHUNK, TOOLS, TOOL_ORDER, inWorld } from '@globalcity/shared';
import type { Actions } from './actions.ts';
import type { Renderer } from './renderer.ts';
import type { AppState } from './state.ts';

export const PAINT_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>(['road', 'rail', 'wire', 'bulldozer', 'park']);

export interface InputHooks {
  /** called when the user clicks with the query tool; (cssX, cssY) is where to show the popover */
  onQueryClick(cssX: number, cssY: number): void;
  /** called on any gesture that should dismiss popovers */
  onInteract(): void;
}

interface PointerInfo { x: number; y: number; sx: number; sy: number; button: number; type: string }
type Mode = 'none' | 'maybe-click' | 'pan' | 'paint' | 'pinch';

const DRAG_THRESHOLD = 4;
const BUILD_INTERVAL_MS = 25;

export class Input {
  private pointers = new Map<number, PointerInfo>();
  private mode: Mode = 'none';
  private spaceHeld = false;
  private lastPaint: { x: number; y: number } | null = null;
  private pinch: { dist: number; zoom: number } | null = null;
  private wheelAcc = 0;
  private lastWheelStep = 0;
  private buildQueue: { x: number; y: number }[] = [];
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
    c.addEventListener('pointerleave', () => { if (this.pointers.size === 0) this.renderer.setHover(null); });
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
    this.hooks.onInteract();
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, button: e.button, type: e.pointerType });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: this.renderer.cam.zoom };
      this.mode = 'pinch';
      this.flushPaint();
      return;
    }
    if (this.pointers.size > 2) return;
    const tool = this.state.tool;
    const panButton = e.button === 1 || e.button === 2;
    if (panButton || this.spaceHeld || !this.renderer.isTileMode() || e.pointerType === 'touch' || tool === 'query') {
      this.mode = panButton || this.spaceHeld ? 'pan' : 'maybe-click';
      return;
    }
    // left button, tile mode, build tool
    this.updateHover(e.clientX, e.clientY);
    const t = this.tileAt(e.clientX, e.clientY);
    if (!inWorld(t.x, t.y)) { this.mode = 'none'; return; }
    if (PAINT_TOOLS.has(tool)) {
      this.mode = 'paint';
      this.lastPaint = t;
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
    if (this.mode === 'pan') {
      this.renderer.panBy(dx, dy);
      this.updateHover(e.clientX, e.clientY);
      return;
    }
    this.updateHover(e.clientX, e.clientY);
    if (this.mode === 'paint' && this.lastPaint) {
      const t = this.tileAt(e.clientX, e.clientY);
      if (t.x !== this.lastPaint.x || t.y !== this.lastPaint.y) {
        this.paintLine(this.lastPaint, t);
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
    if (this.mode === 'maybe-click' && p && this.renderer.isTileMode()) {
      const t = this.tileAt(e.clientX, e.clientY);
      if (inWorld(t.x, t.y)) {
        if (this.state.tool === 'query' || p.button !== 0) {
          if (this.actions.query(t.x, t.y)) this.hooks.onQueryClick(e.clientX, e.clientY);
        } else if (p.type === 'touch') {
          this.actions.build(this.state.tool, t.x, t.y);
        }
      }
    }
    if (this.mode === 'paint') this.flushPaint();
    this.mode = 'none';
    this.lastPaint = null;
    if (e.pointerType === 'touch') this.renderer.setHover(null);
  };

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
      case 'arrowleft': this.renderer.panBy(step, 0); break;
      case 'arrowright': this.renderer.panBy(-step, 0); break;
      case 'arrowup': this.renderer.panBy(0, step); break;
      case 'arrowdown': this.renderer.panBy(0, -step); break;
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
  private paintLine(a: { x: number; y: number }, b: { x: number; y: number }): void {
    // Bresenham so fast drags do not skip tiles
    let x0 = a.x, y0 = a.y;
    const x1 = b.x, y1 = b.y;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let guard = 0;
    while (guard++ < 4096) {
      if (x0 !== a.x || y0 !== a.y) this.enqueueBuild(x0, y0, false);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  private enqueueBuild(x: number, y: number, first: boolean): void {
    if (!inWorld(x, y)) return;
    // while dragging only paint on chunks we own (the first click goes through so the server can explain)
    if (!first && !this.state.ownsChunk(Math.floor(x / CHUNK), Math.floor(y / CHUNK))) return;
    this.buildQueue.push({ x, y });
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
        const tool = this.state.tool;
        if (PAINT_TOOLS.has(tool)) this.actions.build(tool, next.x, next.y);
      }
      if (this.buildQueue.length) this.drainBuilds();
    }, wait);
  }

  private flushPaint(): void { /* queued builds keep draining; nothing else to do */ }
}
