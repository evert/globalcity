// Elevation of every tile (data/world-*/elevation.bin: Int16 little-endian per tile, metres above sea level,
// negative below), read from disk a chunk at a time when asked for, so it costs no memory: it is 256 MB for the
// whole world and only floods use it for now.
import fs from 'node:fs';
import { WORLD_W, CHUNK } from '@globalcity/shared';
import { warn } from './util.ts';

export class Elevation {
  private fd: number | null = null;
  private readonly cache = new Map<number, Int16Array>();

  constructor(file: string | null) {
    if (file && fs.existsSync(file)) this.fd = fs.openSync(file, 'r');
    else if (file) warn(`${file} not found: elevation is 0 everywhere (regenerate the world for real elevation)`);
  }

  get available(): boolean { return this.fd !== null; }

  /** The chunk's elevations, row-major CHUNK*CHUNK (all 0 without the file). */
  chunk(cx: number, cy: number): Int16Array {
    const key = cy * 65536 + cx;
    const hit = this.cache.get(key);
    if (hit) { this.cache.delete(key); this.cache.set(key, hit); return hit; }
    const out = new Int16Array(CHUNK * CHUNK);
    if (this.fd !== null) {
      const row = Buffer.alloc(CHUNK * 2);
      for (let dy = 0; dy < CHUNK; dy++) {
        fs.readSync(this.fd, row, 0, row.length, ((cy * CHUNK + dy) * WORLD_W + cx * CHUNK) * 2);
        for (let dx = 0; dx < CHUNK; dx++) out[dy * CHUNK + dx] = row.readInt16LE(dx * 2);
      }
    }
    this.cache.set(key, out);
    if (this.cache.size > 256) this.cache.delete(this.cache.keys().next().value!);
    return out;
  }

  /** Elevation of one tile in metres. */
  at(x: number, y: number): number {
    const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK);
    return this.chunk(cx, cy)[(y - cy * CHUNK) * CHUNK + (x - cx * CHUNK)];
  }
}
