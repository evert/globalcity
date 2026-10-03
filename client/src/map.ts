// Client-side tile store: one Uint16Array per loaded chunk, plus dirty tracking for the renderer.
import { CHUNK, chunkKey, chunkOf, inWorld } from '@globalcity/shared';
import { Emitter } from './emitter.ts';

export const DIRTY_ALL = -1;

export type MapEvents = {
  /** a chunk was fully (re)loaded */
  chunk: { cx: number; cy: number };
  /** some tiles changed (list of affected chunk keys) */
  tiles: string[];
  /** a chunk was dropped from the store */
  drop: string;
};

export class TileMap extends Emitter<MapEvents> {
  readonly chunks = new Map<string, Uint16Array>();
  /** chunkKey -> list of changed tile indices within the chunk, or [DIRTY_ALL] */
  readonly dirty = new Map<string, number[]>();
  private lastUse = new Map<string, number>();
  private tick = 0;

  constructor(private maxChunks = 320) { super(); }

  has(cx: number, cy: number): boolean { return this.chunks.has(chunkKey(cx, cy)); }

  getChunk(cx: number, cy: number): Uint16Array | undefined {
    const key = chunkKey(cx, cy);
    const c = this.chunks.get(key);
    if (c) this.lastUse.set(key, ++this.tick);
    return c;
  }

  /** Tile value at world coords, or undefined if the chunk is not loaded. */
  get(x: number, y: number): number | undefined {
    if (!inWorld(x, y)) return undefined;
    const { cx, cy } = chunkOf(x, y);
    const c = this.chunks.get(chunkKey(cx, cy));
    if (!c) return undefined;
    return c[(y - cy * CHUNK) * CHUNK + (x - cx * CHUNK)];
  }

  setChunk(cx: number, cy: number, tiles: Uint16Array): void {
    const key = chunkKey(cx, cy);
    this.chunks.set(key, tiles);
    this.lastUse.set(key, ++this.tick);
    this.dirty.set(key, [DIRTY_ALL]);
    this.emit('chunk', { cx, cy });
    this.evict();
  }

  /** Apply a 'tiles' message: flat x,y,value triples. Unknown chunks are ignored. */
  applyTiles(u: number[]): void {
    const touched = new Set<string>();
    for (let i = 0; i + 2 < u.length; i += 3) {
      const x = u[i], y = u[i + 1], v = u[i + 2];
      if (!inWorld(x, y)) continue;
      const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK);
      const key = chunkKey(cx, cy);
      const c = this.chunks.get(key);
      if (!c) continue;
      const idx = (y - cy * CHUNK) * CHUNK + (x - cx * CHUNK);
      if (c[idx] === v) continue;
      c[idx] = v;
      let d = this.dirty.get(key);
      if (!d) { d = []; this.dirty.set(key, d); }
      if (d.length && d[0] === DIRTY_ALL) continue;
      d.push(idx);
      if (d.length > CHUNK * CHUNK / 4) { d.length = 0; d.push(DIRTY_ALL); }
      touched.add(key);
    }
    if (touched.size) this.emit('tiles', [...touched]);
  }

  /** Mark a chunk dirty (e.g. ownership changed so the power overlay must be redrawn). */
  markDirty(cx: number, cy: number): void {
    const key = chunkKey(cx, cy);
    if (!this.chunks.has(key)) return;
    this.dirty.set(key, [DIRTY_ALL]);
    this.emit('tiles', [key]);
  }

  /** Take and clear the dirty set. */
  takeDirty(): Map<string, number[]> {
    const d = new Map(this.dirty);
    this.dirty.clear();
    return d;
  }

  drop(key: string): void {
    if (this.chunks.delete(key)) {
      this.dirty.delete(key);
      this.lastUse.delete(key);
      this.emit('drop', key);
    }
  }

  /** Keep loaded chunks in memory even when unsubscribed (stale but useful), but cap their number (LRU). */
  private evict(): void {
    if (this.chunks.size <= this.maxChunks) return;
    const entries = [...this.lastUse.entries()].sort((a, b) => a[1] - b[1]);
    const n = this.chunks.size - this.maxChunks;
    for (let i = 0; i < n && i < entries.length; i++) this.drop(entries[i][0]);
  }
}
