// The Moon's glass domes: zoomed in, every habitat and commerce zone (and the hospitals and chapels among them)
// stands under a dome, so a city reads as a moon base. Drawn over the tiles each frame, before the night shade, from
// a sprite made once per size; the zone centres of each chunk are found once and kept until the chunk changes.
import { CHUNK, ZONEBIT, LOMASK, RESBASE, INDBASE, chunkKey } from '@globalcity/shared';
import type { TileMap } from './map.ts';

/** Is tile value v the centre of a 3x3 zone that gets a dome (residential, hospital, church, commercial)? */
const domed = (v: number): boolean => (v & ZONEBIT) !== 0 && (v & LOMASK) >= RESBASE && (v & LOMASK) < INDBASE;

export class DomeLayer {
  /** per chunk key: the centres (tile indices within the chunk) of its domed zones */
  private readonly centres = new Map<string, number[]>();
  private sprite: HTMLCanvasElement | null = null;
  private spriteSize = 0;

  constructor(private readonly map: TileMap) {}

  /** A chunk's tiles changed (or arrived): find its zones again when next drawn. */
  markDirty(key: string): void {
    this.centres.delete(key);
  }

  private centresOf(cx: number, cy: number): number[] {
    const key = chunkKey(cx, cy);
    let list = this.centres.get(key);
    if (list) return list;
    const tiles = this.map.getChunk(cx, cy);
    if (!tiles) return [];
    list = [];
    for (let i = 0; i < tiles.length; i++) if (domed(tiles[i])) list.push(i);
    this.centres.set(key, list);
    if (this.centres.size > 4096) this.centres.delete(this.centres.keys().next().value!);
    return list;
  }

  /** One dome, `size` device pixels across (3 tiles): clear glass with a bright rim, a few struts and a glint. */
  private spriteFor(size: number): HTMLCanvasElement {
    if (this.sprite && this.spriteSize === size) return this.sprite;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d')!;
    const r = size / 2 - Math.max(1, size * 0.02),
      m = size / 2;
    const glass = g.createRadialGradient(m - r * 0.35, m - r * 0.4, r * 0.1, m, m, r);
    glass.addColorStop(0, 'rgba(235,248,255,0.20)');
    glass.addColorStop(0.55, 'rgba(170,215,255,0.08)');
    glass.addColorStop(1, 'rgba(150,200,255,0.28)');
    g.fillStyle = glass;
    g.beginPath();
    g.arc(m, m, r, 0, Math.PI * 2);
    g.fill();
    // struts: a geodesic hint, two rings of latitude and two meridians
    g.strokeStyle = 'rgba(225,240,255,0.22)';
    g.lineWidth = Math.max(1, size * 0.012);
    for (const k of [0.35, 0.7]) {
      g.beginPath();
      g.ellipse(m, m + r * (1 - k) * 0.25, r * Math.sqrt(1 - (1 - k) * (1 - k)) * 1.0, r * 0.32 * k, 0, 0, Math.PI * 2);
      g.stroke();
    }
    for (const k of [0.38, 0.8]) {
      g.beginPath();
      g.ellipse(m, m, r * k, r, 0, 0, Math.PI * 2);
      g.stroke();
    }
    // the rim where the dome meets the ground
    g.strokeStyle = 'rgba(240,248,255,0.75)';
    g.lineWidth = Math.max(1, size * 0.025);
    g.beginPath();
    g.arc(m, m, r, 0, Math.PI * 2);
    g.stroke();
    // a glint, up and left (where the art's light comes from)
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.beginPath();
    g.ellipse(m - r * 0.42, m - r * 0.48, r * 0.2, r * 0.09, -Math.PI / 4, 0, Math.PI * 2);
    g.fill();
    this.sprite = c;
    this.spriteSize = size;
    return c;
  }

  /**
   * Draw the domes over chunks cx0..cx1 x cy0..cy1. `dx`/`dy` turn world tiles into device pixels; `t` is a tile in
   * device pixels (domes are skipped when tiles are too small to see them).
   */
  draw(g: CanvasRenderingContext2D, cx0: number, cy0: number, cx1: number, cy1: number, dx: (x: number) => number, dy: (y: number) => number, t: number): void {
    if (t < 3) return;
    const size = Math.max(4, Math.round(t * 3.1));
    const s = this.spriteFor(size);
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++)
        for (const i of this.centresOf(cx, cy)) {
          const x = cx * CHUNK + (i % CHUNK) + 0.5,
            y = cy * CHUNK + Math.floor(i / CHUNK) + 0.5;
          g.drawImage(s, Math.round(dx(x) - size / 2), Math.round(dy(y) - size / 2));
        }
  }
}
