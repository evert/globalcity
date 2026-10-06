// Custom-building layer: buildings of any width x height drawn as one image over their footprint (the
// world only holds generic fill tiles there). The server sends the full list on connect and every
// add/remove after that.
import { CUSTOM_BUILDINGS, type CustomBuilding } from '@globalcity/shared';
import { versioned } from './assets.ts';

export class CustomLayer {
  readonly images = new Map<string, HTMLImageElement>();
  private readonly byKey = new Map<string, CustomBuilding>();
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
    if (op === 'add' && CUSTOM_BUILDINGS[b.kind]) this.byKey.set(`${b.x},${b.y}`, b); else this.byKey.delete(`${b.x},${b.y}`);
    this.onChange();
  }
  /** Buildings overlapping the tile rectangle [x0,x1) x [y0,y1). */
  *within(x0: number, y0: number, x1: number, y1: number): Iterable<CustomBuilding & { w: number; h: number }> {
    for (const b of this.byKey.values()) {
      const d = CUSTOM_BUILDINGS[b.kind];
      if (b.x + d.w > x0 && b.x < x1 && b.y + d.h > y0 && b.y < y1) yield { ...b, w: d.w, h: d.h };
    }
  }
  /** Every building of `kind` the client knows about. */
  *ofKind(kind: string): Iterable<CustomBuilding> {
    for (const b of this.byKey.values()) if (b.kind === kind) yield b;
  }
  ready(kind: string): HTMLImageElement | null {
    const img = this.images.get(kind);
    return img && img.complete && img.naturalWidth > 0 ? img : null;
  }
}
