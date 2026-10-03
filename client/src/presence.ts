// Real-time presence: report our own view to the server (throttled) and smooth other players'
// markers between the server's frames so they glide instead of jumping.
import type { Presence } from '@globalcity/shared';
import { TILE_PX } from '@globalcity/shared';
import type { Net } from './net.ts';
import type { Renderer } from './renderer.ts';
import type { AppState } from './state.ts';

/** Minimum gap between two 'view' messages (4/s). */
export const VIEW_INTERVAL_MS = 250;
/** Markers glide to a new position over this long. */
export const PRESENCE_LERP_MS = 200;
/** Presence frames older than this are not drawn (the server stopped sending, or we lost the connection). */
export const PRESENCE_STALE_MS = 3000;
/** Assumed viewport of other players when drawing their view rectangles in the overview. */
export const ASSUMED_VIEW_W = 1280;
export const ASSUMED_VIEW_H = 800;

/**
 * Sends {t:'view'} whenever the camera or the hovered tile changes, at most once per VIEW_INTERVAL_MS:
 * the first change goes out immediately, further changes inside the window collapse into one trailing send.
 */
export class ViewReporter {
  private last = -Infinity;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastKey = '';

  constructor(readonly net: Net, readonly renderer: Renderer, private readonly now: () => number = () => performance.now()) {}

  /** Call on camera / hover change. */
  poke(): void {
    const wait = this.last + VIEW_INTERVAL_MS - this.now();
    if (wait <= 0) {
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
      this.sendNow();
      return;
    }
    // inside the window: one trailing send picks up the latest view
    if (!this.timer) this.timer = setTimeout(() => { this.timer = null; this.sendNow(); }, wait);
  }

  /** Send the current view right away (e.g. right after welcome), regardless of throttling. */
  sendNow(): boolean {
    const r = this.renderer;
    const cam = r.cam;
    const msg: { t: 'view'; x: number; y: number; zoom: number; cx?: number; cy?: number } = {
      t: 'view', x: Math.round(cam.x * 10) / 10, y: Math.round(cam.y * 10) / 10, zoom: Math.round(cam.zoom * 10000) / 10000,
    };
    if (r.isTileMode() && r.hover) { msg.cx = r.hover.x; msg.cy = r.hover.y; }
    this.last = this.now();
    const key = `${msg.x},${msg.y},${msg.zoom},${msg.cx},${msg.cy}`;
    if (key === this.lastKey) return false; // nothing changed since the last send
    this.lastKey = key;
    return this.net.send(msg);
  }

  /** Forget the last sent view so the next poke/sendNow goes out even if nothing moved (after reconnect/welcome). */
  reset(): void { this.lastKey = ''; }
}

export interface PresenceMarker {
  p: Presence;
  /** displayed (interpolated) camera centre / cursor, tiles */
  x: number; y: number;
  cx?: number; cy?: number;
  hasCursor: boolean;
}

interface Track { from: { x: number; y: number; cx: number; cy: number }; to: { x: number; y: number; cx: number; cy: number }; t0: number; hasCursor: boolean; p: Presence }

/** Keeps per-player interpolation state across presence frames. */
export class PresenceTracker {
  private tracks = new Map<string, Track>();
  private frameAt = 0;

  constructor(readonly state: AppState) {
    state.on('presence', () => this.onFrame(state.presence, state.presenceAt));
  }

  onFrame(players: Presence[], now: number): void {
    this.frameAt = now;
    const seen = new Set<string>();
    for (const p of players) {
      if (!p || typeof p.id !== 'string' || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      seen.add(p.id);
      const hasCursor = Number.isFinite(p.cx) && Number.isFinite(p.cy);
      const to = { x: p.x, y: p.y, cx: hasCursor ? (p.cx as number) : p.x, cy: hasCursor ? (p.cy as number) : p.y };
      const prev = this.tracks.get(p.id);
      if (prev) {
        const cur = this.positionOf(prev, now);
        prev.from = { x: cur.x, y: cur.y, cx: cur.cx ?? to.cx, cy: cur.cy ?? to.cy };
        prev.to = to; prev.t0 = now; prev.hasCursor = hasCursor; prev.p = p;
      } else {
        this.tracks.set(p.id, { from: to, to, t0: now - PRESENCE_LERP_MS, hasCursor, p });
      }
    }
    for (const id of [...this.tracks.keys()]) if (!seen.has(id)) this.tracks.delete(id);
  }

  private positionOf(t: Track, now: number): { x: number; y: number; cx?: number; cy?: number } {
    const k = Math.min(1, Math.max(0, (now - t.t0) / PRESENCE_LERP_MS));
    const e = k * (2 - k); // ease-out
    return {
      x: t.from.x + (t.to.x - t.from.x) * e,
      y: t.from.y + (t.to.y - t.from.y) * e,
      cx: t.hasCursor ? t.from.cx + (t.to.cx - t.from.cx) * e : undefined,
      cy: t.hasCursor ? t.from.cy + (t.to.cy - t.from.cy) * e : undefined,
    };
  }

  /** True while any marker is still gliding (the renderer keeps animating). */
  animating(now: number): boolean {
    for (const t of this.tracks.values()) if (now - t.t0 < PRESENCE_LERP_MS) return true;
    return false;
  }

  /** Current marker positions, or [] when the last frame is stale. */
  markers(now: number): PresenceMarker[] {
    if (!this.frameAt || now - this.frameAt > PRESENCE_STALE_MS) return [];
    const out: PresenceMarker[] = [];
    for (const t of this.tracks.values()) {
      const pos = this.positionOf(t, now);
      out.push({ p: t.p, x: pos.x, y: pos.y, cx: pos.cx, cy: pos.cy, hasCursor: t.hasCursor });
    }
    return out;
  }

  /** Approximate viewport of another player, in tiles (we do not know their window size). */
  static viewSize(zoom: number): { w: number; h: number } {
    const z = Math.max(1e-4, zoom);
    return { w: ASSUMED_VIEW_W / (TILE_PX * z), h: ASSUMED_VIEW_H / (TILE_PX * z) };
  }
}

/** "Mayor · City" (or just the mayor when the city has no name yet). */
export function presenceLabel(p: Presence): string {
  const city = p.cityName ?? '';
  return city ? `${p.name} · ${city}` : p.name;
}
