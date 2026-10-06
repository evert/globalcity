// Persistence: edited chunks as raw little-endian u16 files and players/claims as state.json.
// Writes are atomic (temp file + rename). Flushed every 10 s if dirty and on shutdown.

import fs from 'node:fs';
import path from 'node:path';
import { CHUNK } from '@globalcity/shared';
import { World, chunkCoords, validChunk } from './world.ts';
import { Players, type StateFile } from './players.ts';
import { log, warn } from './util.ts';

const FLUSH_INTERVAL_MS = 10_000;

export class Persist {
  private readonly chunksDir: string;
  private readonly stateFile: string;
  private readonly buildingsFile: string;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly world: World, private readonly players: Players, saveDir: string) {
    this.chunksDir = path.join(saveDir, 'chunks');
    this.stateFile = path.join(saveDir, 'state.json');
    this.buildingsFile = path.join(saveDir, 'buildings.json');
    fs.mkdirSync(this.chunksDir, { recursive: true });
  }

  /** Overlay every saved chunk file onto the world. Returns the number loaded. */
  loadChunks(): number {
    let n = 0;
    const expected = CHUNK * CHUNK * 2;
    for (const name of fs.readdirSync(this.chunksDir)) {
      const m = /^(\d+)_(\d+)\.bin$/.exec(name);
      if (!m) continue;
      const cx = Number(m[1]), cy = Number(m[2]);
      if (!validChunk(cx, cy)) continue;
      const buf = fs.readFileSync(path.join(this.chunksDir, name));
      if (buf.length !== expected) { warn(`Skipping ${name}: size ${buf.length} != ${expected}`); continue; }
      const data = new Uint16Array(CHUNK * CHUNK);
      for (let i = 0; i < data.length; i++) data[i] = buf.readUInt16LE(i * 2);
      this.world.loadChunk(cx, cy, data);
      n++;
    }
    return n;
  }

  loadState(): boolean {
    if (fs.existsSync(this.buildingsFile)) {
      try { this.world.buildings.load(JSON.parse(fs.readFileSync(this.buildingsFile, 'utf8'))); }
      catch (e) { warn(`Could not load ${this.buildingsFile}: ${(e as Error).message}`); }
    }
    if (!fs.existsSync(this.stateFile)) return false;
    try {
      const state = JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) as StateFile;
      if (state.version !== 1 || !Array.isArray(state.players) || !Array.isArray(state.claims)) throw new Error('bad shape');
      this.players.load(state);
      return true;
    } catch (e) {
      warn(`Could not load ${this.stateFile}: ${(e as Error).message}. Starting with empty state.`);
      return false;
    }
  }

  /** Write dirty chunks and (if dirty) state.json. */
  flush(): { chunks: number; state: boolean } {
    let chunks = 0;
    for (const ci of this.world.dirty) {
      const { cx, cy } = chunkCoords(ci);
      const view = this.world.chunkView(cx, cy);
      const buf = Buffer.allocUnsafe(view.length * 2);
      for (let i = 0; i < view.length; i++) buf.writeUInt16LE(view[i], i * 2);
      atomicWrite(path.join(this.chunksDir, `${cx}_${cy}.bin`), buf);
      chunks++;
    }
    this.world.dirty.clear();
    if (this.world.buildings.dirty) {
      atomicWrite(this.buildingsFile, JSON.stringify(this.world.buildings.list()));
      this.world.buildings.dirty = false;
    }
    let state = false;
    if (this.players.dirty) {
      atomicWrite(this.stateFile, JSON.stringify(this.players.serialize()));
      this.players.dirty = false;
      state = true;
    }
    return { chunks, state };
  }

  start(): void {
    this.timer = setInterval(() => {
      try {
        const r = this.flush();
        if (r.chunks > 0) log(`Saved ${r.chunks} chunk(s)`);
      } catch (e) {
        warn('Save failed:', e);
      }
    }, FLUSH_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

function atomicWrite(file: string, data: Buffer | string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}
