// Client-side tile store: one Uint32Array of tile values per loaded chunk, plus dirty tracking for the renderer.
// Predicted builds (predict.ts) are written into the same arrays, so everything that reads the map sees them;
// the server's value underneath is kept aside until the prediction is settled.
import { CHUNK, WORLD_W, LOOK_BITS, chunkKey, chunkOf, inWorld } from '@globalcity/shared';
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

/** A predicted tile: the value shown, the server's value under it, and the newest build (seq) that predicted it. */
interface Predicted {
  v: number;
  auth: number;
  seq: number;
}

export class TileMap extends Emitter<MapEvents> {
  readonly chunks = new Map<string, Uint32Array>();
  /** chunkKey -> list of changed tile indices within the chunk, or [DIRTY_ALL] */
  readonly dirty = new Map<string, number[]>();
  private lastUse = new Map<string, number>();
  private tick = 0;
  /** predicted tiles by world index (y * WORLD_W + x) */
  private readonly predicted = new Map<number, Predicted>();

  constructor(private maxChunks = 320) {
    super();
  }

  has(cx: number, cy: number): boolean {
    return this.chunks.has(chunkKey(cx, cy));
  }

  getChunk(cx: number, cy: number): Uint32Array | undefined {
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

  setChunk(cx: number, cy: number, tiles: Uint32Array): void {
    const key = chunkKey(cx, cy);
    // predictions in this chunk stay on top of the fresh tiles
    for (const [i, p] of this.predicted) {
      const x = i % WORLD_W,
        y = (i - x) / WORLD_W;
      if (Math.floor(x / CHUNK) !== cx || Math.floor(y / CHUNK) !== cy) continue;
      const idx = (y - cy * CHUNK) * CHUNK + (x - cx * CHUNK);
      p.auth = tiles[idx];
      tiles[idx] = p.v;
    }
    this.chunks.set(key, tiles);
    this.lastUse.set(key, ++this.tick);
    this.dirty.set(key, [DIRTY_ALL]);
    this.emit('chunk', { cx, cy });
    this.evict();
  }

  /** Apply a 'tiles' message: flat x,y,value triples. Unknown chunks are ignored; predicted tiles keep showing the prediction. */
  applyTiles(u: number[]): void {
    const touched = new Set<string>();
    for (let i = 0; i + 2 < u.length; i += 3) {
      const x = u[i],
        y = u[i + 1],
        v = u[i + 2];
      if (!inWorld(x, y)) continue;
      const p = this.predicted.get(y * WORLD_W + x);
      if (p) {
        p.auth = v;
        continue;
      }
      this.write(x, y, v, touched);
    }
    if (touched.size) this.emit('tiles', [...touched]);
  }

  /**
   * Show predicted values (world index -> tile value) for build `seq` until it is settled. Each keeps the look
   * (bits 16-24) of the tile it replaces: the client can't work looks out, the server's tiles bring the real one.
   */
  predict(seq: number, values: Map<number, number>): void {
    const touched = new Set<string>();
    for (const [i, value] of values) {
      const x = i % WORLD_W,
        y = (i - x) / WORLD_W;
      const cur = this.get(x, y);
      if (cur === undefined) continue;
      const v = ((value & ~LOOK_BITS) | (cur & LOOK_BITS)) >>> 0;
      const p = this.predicted.get(i);
      if (p) {
        p.v = v;
        p.seq = seq;
      } else this.predicted.set(i, { v, auth: cur, seq });
      this.write(x, y, v, touched);
    }
    if (touched.size) this.emit('tiles', [...touched]);
  }

  /** Drop the predictions of every build up to `seq`: those tiles show the server's values again. */
  settle(seq = Infinity): void {
    const touched = new Set<string>();
    for (const [i, p] of this.predicted) {
      if (p.seq > seq) continue;
      this.predicted.delete(i);
      const x = i % WORLD_W;
      this.write(x, (i - x) / WORLD_W, p.auth, touched);
    }
    if (touched.size) this.emit('tiles', [...touched]);
  }

  /** Number of predicted tiles (tests). */
  get predictedCount(): number {
    return this.predicted.size;
  }

  /** Set a loaded tile and mark it dirty; a no-op if the chunk is not loaded or the value is unchanged. */
  private write(x: number, y: number, v: number, touched: Set<string>): void {
    const cx = Math.floor(x / CHUNK),
      cy = Math.floor(y / CHUNK);
    const key = chunkKey(cx, cy);
    const c = this.chunks.get(key);
    if (!c) return;
    const idx = (y - cy * CHUNK) * CHUNK + (x - cx * CHUNK);
    if (c[idx] === v) return;
    c[idx] = v;
    touched.add(key);
    let d = this.dirty.get(key);
    if (!d) {
      d = [];
      this.dirty.set(key, d);
    }
    if (d.length && d[0] === DIRTY_ALL) return;
    d.push(idx);
    if (d.length > (CHUNK * CHUNK) / 4) {
      d.length = 0;
      d.push(DIRTY_ALL);
    }
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
