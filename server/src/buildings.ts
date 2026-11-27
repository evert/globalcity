// Custom-building layer registry. Buildings in CUSTOM_BUILDINGS have any width x height and are drawn by
// the client as one image. The world holds generic CUSTOMFILL tiles (CUSTOMCENTRE with ZONEBIT at
// footprint offset (1,1)); this registry knows what each building is. Every footprint tile is indexed so
// lookups are O(1). Persisted to <save dir>/buildings.json.
import { WORLD_W, CUSTOM_BUILDINGS, type CustomBuilding } from '@globalcity/shared';

export interface PlacedBuilding extends CustomBuilding {
  w: number;
  h: number;
}

export class Buildings {
  private readonly byAnchor = new Map<number, PlacedBuilding>(); // key: y*WORLD_W+x of the top-left tile
  private readonly cover = new Map<number, number>(); // footprint tile -> anchor key
  dirty = false;
  /** called on add/remove (the network layer broadcasts it) */
  onChange: (op: 'add' | 'remove', b: CustomBuilding) => void = () => {};

  get size(): number {
    return this.byAnchor.size;
  }

  add(kind: string, x: number, y: number): PlacedBuilding {
    const def = CUSTOM_BUILDINGS[kind];
    if (!def) throw new Error(`unknown custom building ${kind}`);
    const b: PlacedBuilding = { kind, x, y, w: def.w, h: def.h };
    const key = y * WORLD_W + x;
    this.byAnchor.set(key, b);
    for (let dy = 0; dy < b.h; dy++) for (let dx = 0; dx < b.w; dx++) this.cover.set((y + dy) * WORLD_W + x + dx, key);
    this.dirty = true;
    this.onChange('add', { kind, x, y });
    return b;
  }

  /** The building covering tile (x,y), if any. */
  at(x: number, y: number): PlacedBuilding | undefined {
    const key = this.cover.get(y * WORLD_W + x);
    return key === undefined ? undefined : this.byAnchor.get(key);
  }

  remove(b: PlacedBuilding): void {
    const key = b.y * WORLD_W + b.x;
    if (!this.byAnchor.delete(key)) return;
    for (let dy = 0; dy < b.h; dy++) for (let dx = 0; dx < b.w; dx++) this.cover.delete((b.y + dy) * WORLD_W + b.x + dx);
    this.dirty = true;
    this.onChange('remove', { kind: b.kind, x: b.x, y: b.y });
  }

  list(): CustomBuilding[] {
    return [...this.byAnchor.values()].map(({ kind, x, y }) => ({ kind, x, y }));
  }

  /** Forget every building, without telling anyone (devReset: the world is back as it was at boot). */
  clear(): void {
    this.byAnchor.clear();
    this.cover.clear();
    this.dirty = false;
  }

  load(list: CustomBuilding[]): void {
    for (const b of list)
      if (CUSTOM_BUILDINGS[b.kind] && Number.isInteger(b.x) && Number.isInteger(b.y)) {
        const def = CUSTOM_BUILDINGS[b.kind];
        const key = b.y * WORLD_W + b.x;
        this.byAnchor.set(key, { ...b, w: def.w, h: def.h });
        for (let dy = 0; dy < def.h; dy++) for (let dx = 0; dx < def.w; dx++) this.cover.set((b.y + dy) * WORLD_W + b.x + dx, key);
      }
  }
}
