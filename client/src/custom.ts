// Custom-building layer: buildings of any width x height drawn as one image over their footprint (the
// world only holds generic fill tiles there). The server sends the full list on connect and every
// add/remove after that. A predicted build (predict.ts) adds or hides one ahead of the server, until settled.
import { CUSTOM_BUILDINGS, type CustomBuilding } from '@globalcity/shared';
import { versioned } from './assets.ts';

export class CustomLayer {
  readonly images = new Map<string, HTMLImageElement>();
  private readonly byKey = new Map<string, CustomBuilding>();
  /** predicted adds and removes, by the seq of the build that predicted them */
  private readonly pending: { seq: number; op: 'add' | 'remove'; b: CustomBuilding }[] = [];
  onChange: () => void = () => {};

  /** Start loading every building image (failures fall back to the plain pavement tiles). */
  load(): void {
    for (const [kind, def] of Object.entries(CUSTOM_BUILDINGS)) {
      const img = new Image();
      img.onload = () => this.onChange();
      img.src = versioned(def.image);
      this.images.set(kind, img);
    }
  }
  set(list: CustomBuilding[]): void {
    this.byKey.clear();
    for (const b of list) if (CUSTOM_BUILDINGS[b.kind]) this.byKey.set(`${b.x},${b.y}`, b);
    this.onChange();
  }
  apply(op: 'add' | 'remove', b: CustomBuilding): void {
    if (op === 'add' && CUSTOM_BUILDINGS[b.kind]) this.byKey.set(`${b.x},${b.y}`, b);
    else this.byKey.delete(`${b.x},${b.y}`);
    this.onChange();
  }
  /** Show a building appearing (`add`) or going (`remove`) for build `seq`, until settled. */
  predict(seq: number, op: 'add' | 'remove', b: CustomBuilding): void {
    this.pending.push({ seq, op, b: { kind: b.kind, x: b.x, y: b.y } });
    this.onChange();
  }
  /** Drop the predictions of every build up to `seq` (by then the server's 'building' messages are in). */
  settle(seq = Infinity): void {
    const n = this.pending.length;
    for (let i = this.pending.length - 1; i >= 0; i--) if (this.pending[i].seq <= seq) this.pending.splice(i, 1);
    if (this.pending.length !== n) this.onChange();
  }
  /** Every building as shown: the server's, with the predicted ones added and the predicted removals gone. */
  private *shown(): Iterable<CustomBuilding> {
    if (!this.pending.length) {
      yield* this.byKey.values();
      return;
    }
    const removed = new Set<string>(),
      added = new Map<string, CustomBuilding>();
    for (const p of this.pending) {
      const key = `${p.b.x},${p.b.y}`;
      if (p.op === 'add') {
        added.set(key, p.b);
        removed.delete(key);
      } else {
        removed.add(key);
        added.delete(key);
      }
    }
    for (const [key, b] of this.byKey) if (!removed.has(key) && !added.has(key)) yield b;
    yield* added.values();
  }
  /** Buildings overlapping the tile rectangle [x0,x1) x [y0,y1). */
  *within(x0: number, y0: number, x1: number, y1: number): Iterable<CustomBuilding & { w: number; h: number }> {
    for (const b of this.shown()) {
      const d = CUSTOM_BUILDINGS[b.kind];
      if (b.x + d.w > x0 && b.x < x1 && b.y + d.h > y0 && b.y < y1) yield { ...b, w: d.w, h: d.h };
    }
  }
  /** The building covering tile (x,y), if any. */
  at(x: number, y: number): (CustomBuilding & { w: number; h: number }) | undefined {
    for (const b of this.within(x, y, x + 1, y + 1)) return b;
    return undefined;
  }
  /** Every building of `kind` the client knows about. */
  *ofKind(kind: string): Iterable<CustomBuilding> {
    for (const b of this.shown()) if (b.kind === kind) yield b;
  }
  ready(kind: string): HTMLImageElement | null {
    const img = this.images.get(kind);
    return img && img.complete && img.naturalWidth > 0 ? img : null;
  }
}
