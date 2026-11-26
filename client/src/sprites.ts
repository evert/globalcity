// Cosmetic sprites (trains, a ship and a helicopter), client-side only: every viewer sees
import { versioned } from './assets.ts';
// their own. Positions are in tile units, motion in tiles per second from the frame delta; the engine is
// stepped by the renderer's frame while something is on screen, so it costs nothing otherwise.
// Sprite artwork: Micropolis objN sprites packed into sprites.png (see sprites.json); a procedural
// fallback (coloured shapes) keeps the game working when the files are missing.
import { CHUNK, LOMASK, PORTBASE, LASTPORT, AIRPORTBASE, LASTAIRPORT, isRail, isWater, inWorld } from '@globalcity/shared';
import type { TileMap } from './map.ts';

export type SpriteKind = 'train' | 'ship' | 'airplane' | 'helicopter';

export interface SpriteDef { w: number; h: number; frames: { x: number; y: number }[] }
export interface SpriteAssets { image: CanvasImageSource | null; defs: Partial<Record<string, SpriteDef>> }

export interface Sprite {
  kind: SpriteKind;
  x: number; // tile units, sprite centre
  y: number;
  frame: number;
  alpha: number;
  /** trains / ship: current heading (unit tile step); airplane: centre of its loop */
  dx: number; dy: number;
  /** progress along the current tile step (trains / ship), 0..1; airplane: angle of the airport on its loop */
  t: number;
  /** airplane: seconds in flight; helicopter: seconds until the next target */
  age: number;
  /** airplane: home (airport centre) / ship: home (seaport) */
  hx: number; hy: number;
  /** tile the sprite is moving towards (trains / ship) */
  tx: number; ty: number;
}

/** Tile-unit speeds and shape of the air loop. */
export const TRAIN_SPEED = 4;
export const SHIP_SPEED = 2;
export const HELI_SPEED = 1.5;
const MAX_TRAINS = 3;
const SCAN_MS = 1000;
const MAX_DT = 0.1; // clamp after a pause (tab hidden) so nothing teleports

/** Direction frames for the 8-frame sprites (ship / airplane / helicopter): clockwise from north. */
export function dirFrame(vx: number, vy: number): number {
  if (vx === 0 && vy === 0) return 0;
  const a = Math.atan2(vx, -vy); // 0 = north, +90deg = east (screen y points down)
  return ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
}
/** Train frames: 0 vertical, 1 horizontal, 2 NE/SW diagonal, 3 NW/SE diagonal (4 is empty in the sheet). */
export function trainFrame(dx: number, dy: number): number { return dx === 0 ? 0 : 1; }

export const SHIP_DIRS: [number, number][] = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
const RAIL_DIRS: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

export async function loadSprites(base = '/assets/micropolis/sprites'): Promise<SpriteAssets> {
  try {
    const res = await fetch(versioned(`${base}.json`));
    if (!res.ok) throw new Error(`${res.status}`);
    const defs = (await res.json()) as Record<string, SpriteDef>;
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image failed'));
      img.src = versioned(`${base}.png`);
    });
    return { image, defs };
  } catch (e) {
    console.warn('[sprites] using procedural sprites:', (e as Error).message);
    return { image: null, defs: {} };
  }
}

export interface SpriteView { x0: number; y0: number; x1: number; y1: number; cx0: number; cy0: number; cx1: number; cy1: number }

/** What the engine found on screen in its last scan. */
export interface SceneScan { rails: number[]; ports: number[]; airports: number[]; water: number[] }

import type { Flight, Voyage } from '@globalcity/shared';
import { flightAlpha, flightFrame } from './flights.ts';

export class SpriteEngine {
  sprites: Sprite[] = [];
  /** test hook: the last on-screen scan (encoded tile coords x + y * WORLD_W... kept as [x,y] pairs flat) */
  scan: SceneScan = { rails: [], ports: [], airports: [], water: [] };
  private lastScan = -Infinity;
  private lastFrame = 0;
  private rand: () => number;
  needScan = true;

  constructor(readonly map: TileMap, public assets: SpriteAssets = { image: null, defs: {} }, rand: () => number = Math.random) {
    this.rand = rand;
    map.on('chunk', () => { this.needScan = true; });
    map.on('tiles', () => { this.needScan = true; });
    map.on('drop', () => { this.needScan = true; });
  }

  /** True while there is something to animate (sprites alive or spawn sources on screen). */
  get active(): boolean { return this.sprites.length > 0 || this.scan.rails.length > 0 || this.scan.ports.length > 0 || this.scan.airports.length > 0; }

  /** Advance the scene for one frame. Returns true when a redraw is wanted next frame. */
  frame(now: number, view: SpriteView, visible = typeof document === 'undefined' || document.visibilityState !== 'hidden'): boolean {
    if (!visible) { this.lastFrame = 0; return false; }
    if (this.needScan || now - this.lastScan >= SCAN_MS) this.rescan(view, now);
    const dt = this.lastFrame ? Math.min(MAX_DT, (now - this.lastFrame) / 1000) : 0;
    this.lastFrame = now;
    this.step(dt, view);
    return this.active;
  }

  /** Scan loaded on-screen chunks for rails / seaports / airports / water, then (de)spawn to match. */
  rescan(view: SpriteView, now = performance.now()): void {
    this.needScan = false;
    this.lastScan = now;
    const s: SceneScan = { rails: [], ports: [], airports: [], water: [] };
    const x0 = Math.floor(view.x0), y0 = Math.floor(view.y0), x1 = Math.ceil(view.x1), y1 = Math.ceil(view.y1);
    for (let cy = view.cy0; cy <= view.cy1; cy++) for (let cx = view.cx0; cx <= view.cx1; cx++) {
      const tiles = this.map.getChunk(cx, cy);
      if (!tiles) continue;
      const bx = cx * CHUNK, by = cy * CHUNK;
      for (let i = 0; i < tiles.length; i++) {
        const x = bx + (i % CHUNK), y = by + Math.floor(i / CHUNK);
        if (x < x0 || x >= x1 || y < y0 || y >= y1) continue;
        const v = tiles[i], id = v & LOMASK;
        if (isRail(v)) s.rails.push(x, y);
        else if (id >= PORTBASE && id <= LASTPORT) s.ports.push(x, y);
        else if (id >= AIRPORTBASE && id <= LASTAIRPORT) s.airports.push(x, y);
        else if (isWater(v)) s.water.push(x, y);
      }
    }
    this.scan = s;
    this.reconcile(view);
  }

  private pick(list: number[]): [number, number] { const i = Math.floor(this.rand() * (list.length / 2)) * 2; return [list[i], list[i + 1]]; }
  private centroid(list: number[]): [number, number] {
    let sx = 0, sy = 0; const n = list.length / 2;
    for (let i = 0; i < list.length; i += 2) { sx += list[i]; sy += list[i + 1]; }
    return [sx / n + 0.5, sy / n + 0.5];
  }

  private reconcile(view: SpriteView): void {
    const s = this.scan;
    const count = (k: SpriteKind) => this.sprites.filter((p) => p.kind === k).length;
    // trains: up to 3, one per 24 rail tiles on screen (at least one when there is any rail)
    const wantTrains = s.rails.length === 0 ? 0 : Math.min(MAX_TRAINS, Math.max(1, Math.floor(s.rails.length / 2 / 24)));
    for (let n = count('train'); n < wantTrains; n++) {
      const [x, y] = this.pick(s.rails);
      const dirs = RAIL_DIRS.filter(([dx, dy]) => this.railAt(x + dx, y + dy));
      const [dx, dy] = dirs.length ? dirs[Math.floor(this.rand() * dirs.length)] : [1, 0];
      this.sprites.push({ kind: 'train', x: x + 0.5, y: y + 0.5, frame: trainFrame(dx, dy), alpha: 1, dx, dy, t: 0, age: 0, hx: x, hy: y, tx: x + dx, ty: y + dy });
    }
    // (Ships sail between mayors' seaports, see flights.ts ShipLayer; no local harbour ship.)
    // airport: one helicopter hovering around the viewport centre. (Planes only fly between two
    // mayors' airports, see flights.ts; a lone airport has none.)
    if (s.airports.length) {
      const [ax, ay] = this.centroid(s.airports);
      if (count('helicopter') === 0) {
        const cx = (view.x0 + view.x1) / 2, cy = (view.y0 + view.y1) / 2;
        this.sprites.push({ kind: 'helicopter', x: ax, y: ay, frame: 0, alpha: 1, dx: 0, dy: 0, t: 0, age: 0, hx: cx, hy: cy, tx: cx, ty: cy });
      }
    }
    // despawn what lost its source
    this.sprites = this.sprites.filter((p) => {
      if (p.kind === 'train' && !this.railAt(Math.floor(p.x), Math.floor(p.y)) && !this.railAt(p.tx, p.ty)) return false;
      if ((p.kind === 'airplane' || p.kind === 'helicopter') && s.airports.length === 0) return false;
      if (p.kind === 'ship' && s.ports.length === 0 && this.offScreen(p, view, 40)) return false;
      return true;
    });
  }

  private railAt(x: number, y: number): boolean { const v = this.map.get(x, y); return v !== undefined && isRail(v); }
  private waterAt(x: number, y: number): boolean { const v = this.map.get(x, y); return v !== undefined && isWater(v); }
  private offScreen(p: Sprite, v: SpriteView, m: number): boolean { return p.x < v.x0 - m || p.x > v.x1 + m || p.y < v.y0 - m || p.y > v.y1 + m; }

  /** Move everything by dt seconds (test hook: call directly). */
  step(dt: number, view: SpriteView): void {
    const keep: Sprite[] = [];
    for (const p of this.sprites) {
      let alive = true;
      switch (p.kind) {
        case 'train': alive = this.stepTrain(p, dt); break;
        case 'ship': alive = this.stepShip(p, dt, view); break;
        case 'airplane': alive = false; break;
        case 'helicopter': this.stepHeli(p, dt, view); break;
      }
      if (alive) keep.push(p);
    }
    this.sprites = keep;
  }

  /** Follow the rail at TRAIN_SPEED, continuing straight when possible, turning at junctions, reversing only at dead ends. */
  private stepTrain(p: Sprite, dt: number): boolean {
    let left = dt * TRAIN_SPEED;
    while (left > 0) {
      const need = 1 - p.t;
      if (left < need) { p.t += left; left = 0; }
      else {
        left -= need; p.t = 0;
        const x = p.tx, y = p.ty;
        if (!this.railAt(x, y)) return false;
        const ahead = RAIL_DIRS.filter(([dx, dy]) => !(dx === -p.dx && dy === -p.dy) && this.railAt(x + dx, y + dy));
        let d: [number, number] | undefined;
        if (ahead.length) {
          const straight = ahead.find(([dx, dy]) => dx === p.dx && dy === p.dy);
          d = straight && this.rand() < 0.7 ? straight : ahead[Math.floor(this.rand() * ahead.length)];
        } else if (this.railAt(x - p.dx, y - p.dy)) d = [-p.dx, -p.dy];
        else return false; // isolated tile
        p.dx = d[0]; p.dy = d[1];
        p.tx = x + d[0]; p.ty = y + d[1];
        p.frame = trainFrame(p.dx, p.dy);
      }
    }
    p.x = p.tx + 0.5 - p.dx * (1 - p.t);
    p.y = p.ty + 0.5 - p.dy * (1 - p.t);
    return true;
  }

  /** Random walk over water near the seaport, preferring to continue straight; drifts back when it strays. */
  private stepShip(p: Sprite, dt: number, view: SpriteView): boolean {
    let left = dt * SHIP_SPEED / (Math.hypot(p.dx, p.dy) || 1);
    while (left > 0) {
      const need = 1 - p.t;
      if (left < need) { p.t += left; left = 0; }
      else {
        left -= need; p.t = 0;
        const x = p.tx, y = p.ty;
        const far = Math.hypot(x - p.hx, y - p.hy) > 14;
        let cands = SHIP_DIRS.filter(([dx, dy]) => !(dx === -p.dx && dy === -p.dy) && inWorld(x + dx, y + dy) && this.waterAt(x + dx, y + dy));
        if (far) {
          const homeward = cands.filter(([dx, dy]) => (x + dx - p.hx) * (x - p.hx) + (y + dy - p.hy) * (y - p.hy) < (x - p.hx) ** 2 + (y - p.hy) ** 2);
          if (homeward.length) cands = homeward;
        }
        let d: [number, number] | undefined;
        if (cands.length) {
          const straight = cands.find(([dx, dy]) => dx === p.dx && dy === p.dy);
          d = straight && this.rand() < 0.8 ? straight : cands[Math.floor(this.rand() * cands.length)];
        } else if (this.waterAt(x - p.dx, y - p.dy)) d = [-p.dx, -p.dy];
        else { p.x = x + 0.5; p.y = y + 0.5; return !this.offScreen(p, view, 40); } // boxed in: float in place
        p.dx = d[0]; p.dy = d[1];
        p.tx = x + d[0]; p.ty = y + d[1];
        p.frame = dirFrame(p.dx, p.dy);
      }
    }
    p.x = p.tx + 0.5 - p.dx * (1 - p.t);
    p.y = p.ty + 0.5 - p.dy * (1 - p.t);
    return !this.offScreen(p, view, 40);
  }

  /** Hover around the viewport centre: slow drift between random targets within ~12 tiles of it. */
  private stepHeli(p: Sprite, dt: number, view: SpriteView): void {
    const cx = (view.x0 + view.x1) / 2, cy = (view.y0 + view.y1) / 2;
    p.age -= dt;
    const dist = Math.hypot(p.tx - p.x, p.ty - p.y);
    if (p.age <= 0 || dist < 0.3) {
      p.tx = cx + (this.rand() - 0.5) * 24; p.ty = cy + (this.rand() - 0.5) * 24;
      p.age = 6 + this.rand() * 6;
    }
    if (dist > 0.3) {
      const vx = (p.tx - p.x) / dist, vy = (p.ty - p.y) / dist;
      const m = Math.min(dist, HELI_SPEED * dt);
      p.x += vx * m; p.y += vy * m;
      p.frame = dirFrame(vx, vy);
    }
  }

  /** Draw all sprites. `toPx` maps tile coords to device pixels; `tilePx` is the device-pixel size of one tile. */
  draw(g: CanvasRenderingContext2D, toPx: (tx: number, ty: number) => { x: number; y: number }, tilePx: number): void {
    if (!this.sprites.length) return;
    const scale = tilePx / 16;
    g.imageSmoothingEnabled = false;
    for (const p of this.sprites) {
      const { x, y } = toPx(p.x, p.y);
      const def = this.assets.defs[p.kind];
      const img = this.assets.image;
      g.globalAlpha = p.alpha;
      if (img && def && def.frames[p.frame]) {
        const f = def.frames[p.frame];
        const w = def.w * scale, h = def.h * scale;
        g.drawImage(img, f.x, f.y, def.w, def.h, Math.round(x - w / 2), Math.round(y - h / 2), Math.round(w), Math.round(h));
      } else {
        this.drawFallback(g, p, x, y, tilePx);
      }
    }
    g.globalAlpha = 1;
  }

  /**
   * Draw inter-city flights. `toPx` maps tile coords to device pixels (may return null when off screen);
   * `px` is the device-pixel width to draw a 48px airplane frame at.
   */
  drawFlights(g: CanvasRenderingContext2D, flights: Flight[], toPx: (tx: number, ty: number) => { x: number; y: number } | null, px: number): void {
    const def = this.assets.defs.airplane, img = this.assets.image;
    g.imageSmoothingEnabled = false;
    for (const f of flights) {
      const at = toPx(f.x, f.y);
      if (!at) continue;
      const frame = flightFrame(f, dirFrame);
      g.globalAlpha = flightAlpha(f);
      if (img && def && def.frames[frame]) {
        const fr = def.frames[frame];
        const w = px, h = px * def.h / def.w;
        g.drawImage(img, fr.x, fr.y, def.w, def.h, Math.round(at.x - w / 2), Math.round(at.y - h / 2), Math.round(w), Math.round(h));
      } else {
        this.drawFallback(g, { kind: 'airplane', x: f.x, y: f.y, frame, alpha: 1, dx: 0, dy: 0, t: 0, age: 0, hx: 0, hy: 0, tx: 0, ty: 0 }, at.x, at.y, px / 3);
      }
    }
    g.globalAlpha = 1;
  }

  /** Draw ships sailing between ports (zoomed in): the Micropolis ship sprite facing its heading. */
  drawShips(g: CanvasRenderingContext2D, ships: Voyage[], toPx: (tx: number, ty: number) => { x: number; y: number } | null, px: number): void {
    const def = this.assets.defs.ship, img = this.assets.image;
    g.imageSmoothingEnabled = false;
    for (const v of ships) {
      const at = toPx(v.x, v.y);
      if (!at) continue;
      const frame = dirFrame(v.vx, v.vy);
      g.globalAlpha = Math.min(1, Math.min(v.progress, 1 - v.progress) * v.duration / 1500);
      if (img && def && def.frames[frame]) {
        const f = def.frames[frame];
        const w = px, h = px * def.h / def.w;
        g.drawImage(img, f.x, f.y, def.w, def.h, Math.round(at.x - w / 2), Math.round(at.y - h / 2), Math.round(w), Math.round(h));
      } else {
        this.drawFallback(g, { kind: 'ship', x: v.x, y: v.y, frame, alpha: 1, dx: 0, dy: 0, t: 0, age: 0, hx: 0, hy: 0, tx: 0, ty: 0 }, at.x, at.y, px / 3);
      }
    }
    g.globalAlpha = 1;
  }

  /** A Micropolis tornado at (x, y) device pixels, `px` wide; `t` (ms) picks the animation frame. */
  drawTornado(g: CanvasRenderingContext2D, x: number, y: number, px: number, t: number): void {
    const def = this.assets.defs.tornado, img = this.assets.image;
    g.imageSmoothingEnabled = false;
    if (img && def && def.frames.length) {
      const f = def.frames[Math.floor(t / 120) % def.frames.length];
      const w = px, h = px * def.h / def.w;
      g.drawImage(img, f.x, f.y, def.w, def.h, Math.round(x - w / 2), Math.round(y - h * 0.8), Math.round(w), Math.round(h));
    } else {
      g.fillStyle = 'rgba(200,200,200,0.85)';
      g.beginPath(); g.moveTo(x - px / 2, y - px); g.lineTo(x + px / 2, y - px); g.lineTo(x, y); g.closePath(); g.fill();
    }
  }

  private drawFallback(g: CanvasRenderingContext2D, p: Sprite, x: number, y: number, tp: number): void {
    const s = tp;
    g.save();
    g.translate(x, y);
    switch (p.kind) {
      case 'train': {
        g.fillStyle = '#2b2b33';
        if (p.dx !== 0) g.fillRect(-s * 0.9, -s * 0.3, s * 1.8, s * 0.6); else g.fillRect(-s * 0.3, -s * 0.9, s * 0.6, s * 1.8);
        g.fillStyle = '#ffd54f'; g.fillRect(-s * 0.15, -s * 0.15, s * 0.3, s * 0.3);
        break;
      }
      case 'ship': {
        g.rotate(p.frame * Math.PI / 4);
        g.fillStyle = '#e0e0e0'; g.beginPath(); g.moveTo(0, -s * 1.2); g.lineTo(s * 0.5, s * 0.8); g.lineTo(-s * 0.5, s * 0.8); g.closePath(); g.fill();
        g.fillStyle = '#c62828'; g.fillRect(-s * 0.2, -s * 0.2, s * 0.4, s * 0.5);
        break;
      }
      case 'airplane': {
        g.rotate(Math.min(p.frame, 7) * Math.PI / 4);
        g.fillStyle = '#f5f5f5';
        g.fillRect(-s * 0.15, -s * 1.3, s * 0.3, s * 2.6); g.fillRect(-s * 1.2, -s * 0.2, s * 2.4, s * 0.4); g.fillRect(-s * 0.5, s * 0.9, s, s * 0.25);
        break;
      }
      case 'helicopter': {
        g.fillStyle = '#37474f'; g.beginPath(); g.arc(0, 0, s * 0.45, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#cfd8dc'; g.lineWidth = Math.max(1, s * 0.12);
        const a = (performance.now() / 60) % Math.PI;
        g.beginPath(); g.moveTo(Math.cos(a) * s, Math.sin(a) * s); g.lineTo(-Math.cos(a) * s, -Math.sin(a) * s); g.stroke();
        break;
      }
    }
    g.restore();
  }
}
