// Map overlays (SimCity "map views") for the zoomed-in view: power, fire hazard, crime, traffic, pollution,
// land value and density. Computed in the browser from the tiles the client already has; one 64x64 image per plot (one
// pixel per tile) drawn on top of a dimmed map. Rebuilt only when tiles change or the mode changes.
import {
  CHUNK,
  LOMASK,
  ZONEBIT,
  PWRBIT,
  CONDBIT,
  BURNBIT,
  FIRESTATION,
  POLICESTATION,
  FIRE_STATION_RANGE,
  POLICE_RANGE,
  UNIVERSITY_POLICE_FACTOR,
  CRIME_LAND_VALUE_THRESHOLD,
  LTRFBASE,
  HTRFBASE,
  LASTROAD,
  isRoad,
  isWater,
  isTree,
  isIndZone,
  isComZone,
  isHouse,
  isZoneTile,
  chunkKey,
  parseChunkKey,
  SCHOOL,
  SCHOOL_RANGE,
  CHRISTMAS_TREE_RANGE,
  pollutionSource,
  pollutionAt,
  POLLUTION_HIGH,
  POLLUTION_SEVERE,
  POLLUTION_MAX_RADIUS,
  FREEZ,
  RZB,
  HOSPITALBASE,
  CZB,
  COMLAST,
  IZB,
  INDLAST,
  resZonePop,
  comZonePop,
  indZonePop,
  displayPopulation,
} from '@globalcity/shared';
import type { TileMap } from './map.ts';

export type OverlayMode = 'none' | 'power' | 'fire' | 'crime' | 'traffic' | 'pollution' | 'value' | 'density';
export const OVERLAY_MODES: readonly OverlayMode[] = ['none', 'power', 'fire', 'crime', 'traffic', 'pollution', 'value', 'density'];

type RGBA = [number, number, number, number];
export interface LegendItem {
  color: string;
  label: string;
}
export const OVERLAY_INFO: Record<OverlayMode, { name: string; icon: string; legend: LegendItem[]; note?: string }> = {
  none: { name: 'Normal', icon: '🗺', legend: [] },
  power: {
    name: 'Power',
    icon: '⚡',
    legend: [
      { color: '#3ad16b', label: 'Powered' },
      { color: '#ff4a3d', label: 'No power' },
    ],
  },
  fire: {
    name: 'Fire hazard',
    icon: '🔥',
    legend: [
      { color: '#4aa8ff', label: 'Fire station coverage' },
      { color: '#ff4a3d', label: 'Unprotected buildings' },
    ],
    note: `Powered fire stations protect ${FIRE_STATION_RANGE} tiles around them: most fires there never start, and the rest spread slower and burn out sooner.`,
  },
  crime: {
    name: 'Crime',
    icon: '👮',
    legend: [
      { color: '#4aa8ff', label: 'Police coverage' },
      { color: '#ff8a1e', label: 'Unpatrolled zones' },
    ],
    note: `Powered police stations cover ${POLICE_RANGE} tiles, or ${POLICE_RANGE * UNIVERSITY_POLICE_FACTOR} in a city with a powered university. In a city with high crime, lots outside that range lose land value.`,
  },
  traffic: {
    name: 'Traffic',
    icon: '🚗',
    legend: [
      { color: '#3ad16b', label: 'Free flowing' },
      { color: '#ffd23a', label: 'Busy' },
      { color: '#ff4a3d', label: 'Jammed' },
    ],
    note: 'Rail next to zones takes trips off the roads.',
  },
  pollution: {
    name: 'Pollution',
    icon: '🏭',
    legend: [
      { color: '#c8b04a', label: 'Some' },
      { color: '#a06428', label: 'Heavy' },
      { color: '#6e2a1e', label: 'Smog' },
      { color: '#3a1410', label: 'Heavy smog' },
    ],
    note: "Smog lowers land value and stops homes growing taller. Coal plants pollute far more than anything else. Factories, heavy traffic, airports and seaports pollute too. Wind farms, nuclear plants and parks don't.",
  },
  value: {
    name: 'Land value',
    icon: '💎',
    legend: [
      { color: '#c0392b', label: 'Low' },
      { color: '#e67e22', label: '' },
      { color: '#d4c63a', label: '' },
      { color: '#2ecc71', label: 'High' },
    ],
    note: 'Parks, forest and water nearby raise value, and so do shops within 8 tiles and a school within 8. Industry within 12 tiles and smog lower it.',
  },
  density: {
    name: 'Density',
    icon: '🏙',
    legend: [
      { color: '#ffeca0', label: 'Sparse' },
      { color: '#ffc45a', label: '' },
      { color: '#f58232', label: '' },
      { color: '#d73c3c', label: '' },
      { color: '#821e5a', label: 'Dense' },
    ],
    note: 'People living or working on each lot, counted as in your population: a lot of houses holds up to 160, apartment blocks and offices up to 800, factories up to 640.',
  },
};

const GREEN: RGBA = [58, 209, 107, 200],
  RED: RGBA = [255, 74, 61, 220],
  BLUE: RGBA = [74, 168, 255, 70],
  ORANGE: RGBA = [255, 138, 30, 210],
  YELLOW: RGBA = [255, 210, 58, 220];
const VALUE: RGBA[] = [
  [192, 57, 43, 150],
  [230, 126, 34, 150],
  [212, 198, 58, 150],
  [46, 204, 113, 150],
];
const DENSITY: RGBA[] = [
  [255, 236, 160, 140],
  [255, 196, 90, 165],
  [245, 130, 50, 190],
  [215, 60, 60, 210],
  [130, 30, 90, 225],
];
const DENSITY_STEP = 160; // people per colour step: a full lot of houses is one step, the densest lots five
const isBuilding = (v: number): boolean => isZoneTile(v) || isHouse(v);

export class OverlayLayer {
  mode: OverlayMode = 'none';
  private canvases = new Map<string, HTMLCanvasElement>();
  private fireCover = new Set<number>(); // tile index y*65536+x covered (packed)
  private policeCover = new Set<number>();
  /** set by the renderer: owner id of the plot under a tile, and the owners whose university is powered */
  ownerAt: (x: number, y: number) => string | undefined = () => undefined;
  uniOwners: () => Set<string> = () => new Set();
  /** set by the renderer: centres of the powered Christmas trees */
  xmasTrees: () => { x: number; y: number }[] = () => [];
  private schoolCover = new Set<number>();
  private xmasCover = new Set<number>();
  /** pollution sources in loaded chunks: x, y, strength, radius */
  private sources: number[] = [];
  private coverDirty = true;
  /** crime level of the viewer's own city (0..1), for the crime/value overlays */
  ownCrime = 0;
  isOwn: (cx: number, cy: number) => boolean = () => false;

  constructor(private readonly map: TileMap) {
    map.on('chunk', () => this.invalidate());
    map.on('tiles', () => this.invalidate());
  }

  setMode(m: OverlayMode): void {
    if (m !== this.mode) {
      this.mode = m;
      this.invalidate();
    }
  }
  invalidate(): void {
    this.canvases.clear();
    this.coverDirty = true;
  }

  /** 64x64 overlay image for a plot (null in normal mode or when the plot isn't loaded). */
  canvasFor(cx: number, cy: number): HTMLCanvasElement | null {
    if (this.mode === 'none') return null;
    const key = chunkKey(cx, cy);
    let c = this.canvases.get(key);
    if (c) return c;
    const tiles = this.map.getChunk(cx, cy);
    if (!tiles) return null;
    if (this.coverDirty) this.computeCoverage();
    c = this.build(cx, cy, tiles);
    this.canvases.set(key, c);
    return c;
  }

  private computeCoverage(): void {
    this.coverDirty = false;
    this.fireCover.clear();
    this.policeCover.clear();
    this.schoolCover.clear();
    this.xmasCover.clear();
    this.sources = [];
    const uni = this.uniOwners();
    const R = CHRISTMAS_TREE_RANGE;
    for (const t of this.xmasTrees()) for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) this.xmasCover.add((t.y + dy) * 65536 + (t.x + dx));
    for (const [key, tiles] of this.map.chunks) {
      const { cx, cy } = parseChunkKey(key);
      for (let i = 0; i < tiles.length; i++) {
        const v = tiles[i];
        const src = pollutionSource(v);
        if (src) this.sources.push(cx * CHUNK + (i % CHUNK), cy * CHUNK + Math.floor(i / CHUNK), src.strength, src.radius);
        if (!(v & ZONEBIT) || !(v & PWRBIT)) continue;
        const id = v & LOMASK;
        if (id !== FIRESTATION && id !== POLICESTATION && id !== SCHOOL) continue;
        const x = cx * CHUNK + (i % CHUNK),
          y = cy * CHUNK + Math.floor(i / CHUNK);
        let r = id === FIRESTATION ? FIRE_STATION_RANGE : id === POLICESTATION ? POLICE_RANGE : SCHOOL_RANGE;
        if (id === POLICESTATION && uni.size) {
          const o = this.ownerAt(x, y);
          if (o && uni.has(o)) r *= UNIVERSITY_POLICE_FACTOR;
        }
        const set = id === FIRESTATION ? this.fireCover : id === POLICESTATION ? this.policeCover : this.schoolCover;
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) set.add((y + dy) * 65536 + (x + dx));
      }
    }
  }

  private get(x: number, y: number): number {
    return this.map.get(x, y) ?? 0;
  }

  /** Pollution for every tile of the plot at (bx, by), from sources in loaded chunks (shared formula). */
  private pollution(bx: number, by: number): Float32Array {
    const out = new Float32Array(CHUNK * CHUNK);
    const R = POLLUTION_MAX_RADIUS,
      src = this.sources;
    for (let k = 0; k < src.length; k += 4) {
      const sx = src[k],
        sy = src[k + 1],
        s = { strength: src[k + 2], radius: src[k + 3] };
      if (sx < bx - R || sx >= bx + CHUNK + R || sy < by - R || sy >= by + CHUNK + R) continue;
      for (let y = Math.max(by, sy - s.radius); y <= Math.min(by + CHUNK - 1, sy + s.radius); y++)
        for (let x = Math.max(bx, sx - s.radius); x <= Math.min(bx + CHUNK - 1, sx + s.radius); x++)
          out[(y - by) * CHUNK + (x - bx)] += pollutionAt(s, Math.max(Math.abs(x - sx), Math.abs(y - sy)));
    }
    return out;
  }

  private build(cx: number, cy: number, tiles: Uint32Array): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = CHUNK;
    c.height = CHUNK;
    const g = c.getContext('2d')!;
    const img = g.createImageData(CHUNK, CHUNK);
    const put = (i: number, col: RGBA) => {
      img.data[i * 4] = col[0];
      img.data[i * 4 + 1] = col[1];
      img.data[i * 4 + 2] = col[2];
      img.data[i * 4 + 3] = col[3];
    };
    const bx = cx * CHUNK,
      by = cy * CHUNK;
    const own = this.isOwn(cx, cy);
    const value = this.mode === 'value' ? this.landValues(bx, by) : null;
    const smog = this.mode === 'pollution' ? this.pollution(bx, by) : null;
    const dens = this.mode === 'density' ? this.density(bx, by) : null;
    for (let i = 0; i < tiles.length; i++) {
      const v = tiles[i],
        id = v & LOMASK;
      const x = bx + (i % CHUNK),
        y = by + Math.floor(i / CHUNK),
        k = y * 65536 + x;
      switch (this.mode) {
        case 'power':
          if (v & CONDBIT) put(i, v & PWRBIT ? GREEN : RED);
          break;
        case 'fire':
          if (isBuilding(v) && v & BURNBIT && !this.fireCover.has(k)) put(i, RED);
          else if (this.fireCover.has(k)) put(i, BLUE);
          break;
        case 'crime':
          if (isBuilding(v) && !this.policeCover.has(k)) {
            const a = own ? Math.round(90 + 140 * Math.min(1, this.ownCrime * 2)) : 150;
            put(i, [ORANGE[0], ORANGE[1], ORANGE[2], a]);
          } else if (this.policeCover.has(k)) put(i, BLUE);
          break;
        case 'traffic':
          if (isRoad(v)) put(i, id >= HTRFBASE && id <= LASTROAD ? RED : id >= LTRFBASE && id < HTRFBASE ? YELLOW : GREEN);
          break;
        case 'value':
          if (!isWater(v) && value) put(i, VALUE[value[i]]);
          break;
        case 'pollution': {
          const p = smog ? smog[i] : 0;
          if (p >= POLLUTION_SEVERE) put(i, [58, 20, 16, 225]);
          else if (p >= POLLUTION_HIGH) put(i, [110, 42, 30, 210]);
          else if (p >= 30) put(i, [160, 100, 40, Math.round(110 + p * 2)]);
          else if (p >= 5) put(i, [200, 176, 74, Math.round(60 + p * 3)]);
          break;
        }
        case 'density':
          if (dens && dens[i]) put(i, DENSITY[dens[i] - 1]);
          break;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  /** Density step 1..5 for every tile of the plot at (bx, by) from the people on its lot (0: nobody). */
  private density(bx: number, by: number): Uint8Array {
    const out = new Uint8Array(CHUNK * CHUNK);
    // lot centres just outside the plot still cover its edge tiles
    for (let y = by - 1; y <= by + CHUNK; y++)
      for (let x = bx - 1; x <= bx + CHUNK; x++) {
        const v = this.get(x, y);
        if (!(v & ZONEBIT)) continue;
        const people = this.lotPeople(v, x, y);
        if (!people) continue;
        const step = Math.min(DENSITY.length, Math.ceil(people / DENSITY_STEP));
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const lx = x + dx - bx,
              ly = y + dy - by;
            if (lx >= 0 && lx < CHUNK && ly >= 0 && ly < CHUNK) out[ly * CHUNK + lx] = step;
          }
      }
    return out;
  }

  /** People on the 3x3 lot centred at (x, y), weighted like the city population (displayPopulation). */
  private lotPeople(v: number, x: number, y: number): number {
    const id = v & LOMASK;
    if (id === FREEZ) {
      let houses = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && isHouse(this.get(x + dx, y + dy))) houses++;
      return displayPopulation(houses, 0, 0);
    }
    if (id >= RZB && id < HOSPITALBASE) return displayPopulation(resZonePop(id), 0, 0);
    if (id >= CZB && id <= COMLAST) return displayPopulation(0, comZonePop(id), 0);
    if (id >= IZB && id <= INDLAST) return displayPopulation(0, 0, indZonePop(id));
    return 0;
  }

  /**
   * Land value 0..3 for every tile of the plot at (bx, by), with the server's rules (sim.ts landValue):
   * +1 park/forest/water within 3 tiles, +1 no industry within 12, +1 commerce within 8, +1 near a powered school
   * or Christmas tree, -1 for a high-crime
   * own city outside police cover. Box sums keep it to O(1) per tile.
   */
  private landValues(bx: number, by: number): Uint8Array {
    const M = 12,
      W = CHUNK + 2 * M,
      x0 = bx - M,
      y0 = by - M;
    const nat = new Int32Array((W + 1) * (W + 1)),
      ind = new Int32Array((W + 1) * (W + 1)),
      com = new Int32Array((W + 1) * (W + 1));
    for (let y = 0; y < W; y++)
      for (let x = 0; x < W; x++) {
        const v = this.get(x0 + x, y0 + y),
          id = v & LOMASK;
        const o = (y + 1) * (W + 1) + (x + 1),
          up = y * (W + 1) + (x + 1),
          left = o - 1,
          diag = up - 1;
        const n = isTree(v) || isWater(v) || (id >= 40 && id <= 43) ? 1 : 0;
        nat[o] = n + nat[up] + nat[left] - nat[diag];
        ind[o] = (isIndZone(v) ? 1 : 0) + ind[up] + ind[left] - ind[diag];
        com[o] = (isComZone(v) ? 1 : 0) + com[up] + com[left] - com[diag];
      }
    const box = (a: Int32Array, x: number, y: number, r: number) => {
      const xa = x - r,
        ya = y - r,
        xb = x + r + 1,
        yb = y + r + 1;
      return a[yb * (W + 1) + xb] - a[ya * (W + 1) + xb] - a[yb * (W + 1) + xa] + a[ya * (W + 1) + xa];
    };
    const out = new Uint8Array(CHUNK * CHUNK);
    const smog = this.pollution(bx, by);
    const highCrime = this.isOwn(Math.floor(bx / CHUNK), Math.floor(by / CHUNK)) && this.ownCrime >= CRIME_LAND_VALUE_THRESHOLD;
    for (let i = 0; i < out.length; i++) {
      const lx = i % CHUNK,
        ly = Math.floor(i / CHUNK),
        x = lx + M,
        y = ly + M;
      let val = 0;
      if (box(nat, x, y, 3) > 0) val++;
      if (box(ind, x, y, 12) === 0) val++;
      if (box(com, x, y, 8) > 0) val++;
      const wx = bx + lx,
        wy = by + ly;
      if (smog[i] >= POLLUTION_HIGH) val--;
      if (smog[i] >= POLLUTION_SEVERE) val--;
      if (this.schoolCover.has(wy * 65536 + wx)) val++;
      if (this.xmasCover.has(wy * 65536 + wx)) val++;
      if (highCrime && !this.policeCover.has(wy * 65536 + wx)) val--;
      // (The server also adds a per-lot random step to vary building looks; the overlay leaves it out so
      // it shows the underlying value as smooth areas rather than speckle.)
      out[i] = Math.max(0, Math.min(3, val));
    }
    return out;
  }
}
