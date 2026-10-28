// Sea routes between powered seaports. A coarse water grid (CELL x CELL tiles per cell, 1024 x 512 for the
// whole planet, wrapping east-west at the date line) is built once; for each port one breadth-first search
// (8-neighbour) finds paths to every other port, which are then straightened (line-of-sight string pulling)
// into a few waypoints. Searches run one per call to step(), so the tick never stalls. Ports whose water
// doesn't connect (lakes) simply get no routes.
import { WORLD_W, WORLD_H, isWater, type PortInfo, type SeaRoute } from '@globalcity/shared';
import type { World } from './world.ts';
import { log } from './util.ts';

const CELL = 8;
const GW = WORLD_W / CELL, GH = WORLD_H / CELL;
const PORT_SEARCH_CELLS = 4; // a port uses the nearest water cell within this many cells

export class ShippingPlanner {
  private readonly water = new Uint8Array(GW * GH);
  ports: PortInfo[] = [];
  routes: SeaRoute[] = [];
  /** bumps whenever ports or routes change (the network layer re-publishes) */
  version = 0;
  private portsKey = '';
  private readonly cache = new Map<string, number[] | null>(); // "ax,ay>bx,by" (sorted) -> waypoints
  private queue: PortInfo[] = [];

  constructor(world: World) {
    const t0 = performance.now();
    for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
      let n = 0;
      for (let y = gy * CELL; y < gy * CELL + CELL; y++) for (let x = gx * CELL; x < gx * CELL + CELL; x++) if (isWater(world.tiles[y * WORLD_W + x])) n++;
      this.water[gy * GW + gx] = n >= (CELL * CELL) / 2 ? 1 : 0;
    }
    log(`shipping: water grid ${GW}x${GH} built in ${(performance.now() - t0).toFixed(0)} ms`);
  }

  private static pairKey(a: PortInfo, b: PortInfo): string {
    const ka = `${a.x},${a.y}`, kb = `${b.x},${b.y}`;
    return ka < kb ? `${ka}>${kb}` : `${kb}>${ka}`;
  }

  /** New set of powered seaports (sorted). Queues searches for ports with missing pairs. */
  setPorts(ports: PortInfo[]): void {
    const key = JSON.stringify(ports);
    if (key === this.portsKey) return;
    this.portsKey = key;
    this.ports = ports;
    const need = new Set<string>();
    for (let i = 0; i < ports.length; i++) for (let j = i + 1; j < ports.length; j++) {
      if (ports[i].ownerId === ports[j].ownerId) continue;
      if (!this.cache.has(ShippingPlanner.pairKey(ports[i], ports[j]))) need.add(`${ports[i].x},${ports[i].y}`);
    }
    this.queue = ports.filter((p) => need.has(`${p.x},${p.y}`));
    this.rebuild();
  }

  /**
   * Run queued port searches until `budgetMs` is spent (at least one). A search is a few ms, so a tick's
   * budget clears most of the queue at once: every republish of the routes re-deals ships, so the fewer
   * partial route lists the clients see, the less the ships jump about.
   */
  step(budgetMs = 40): void {
    if (!this.queue.length) return;
    const t0 = performance.now();
    let searched = 0, found = 0;
    while (this.queue.length && (searched === 0 || performance.now() - t0 < budgetMs)) {
      found += this.searchFrom(this.queue.shift()!);
      searched++;
    }
    log(`shipping: routes from ${searched} port(s): ${found} new in ${(performance.now() - t0).toFixed(0)} ms, ${this.queue.length} port(s) queued`);
    this.rebuild();
  }

  private rebuild(): void {
    const routes: SeaRoute[] = [];
    for (let i = 0; i < this.ports.length; i++) for (let j = i + 1; j < this.ports.length; j++) {
      const a = this.ports[i], b = this.ports[j];
      if (a.ownerId === b.ownerId) continue;
      const k = ShippingPlanner.pairKey(a, b);
      const pts = this.cache.get(k);
      if (!pts) continue;
      // cached in sorted-key order; orient from a to b
      const forward = `${a.x},${a.y}` < `${b.x},${b.y}`;
      routes.push({ a: i, b: j, pts: forward ? pts : reverse(pts) });
    }
    const before = JSON.stringify(this.routes);
    this.routes = routes;
    if (JSON.stringify(routes) !== before) this.version++;
  }

  private cellOf(p: PortInfo): number {
    const cx = Math.floor(p.x / CELL), cy = Math.floor(p.y / CELL);
    let best = -1, bd = Infinity;
    for (let dy = -PORT_SEARCH_CELLS; dy <= PORT_SEARCH_CELLS; dy++) for (let dx = -PORT_SEARCH_CELLS; dx <= PORT_SEARCH_CELLS; dx++) {
      const gx = (cx + dx + GW) % GW, gy = cy + dy;
      if (gy < 0 || gy >= GH || !this.water[gy * GW + gx]) continue;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = gy * GW + gx; }
    }
    return best;
  }

  /** BFS from src's water cell; store straightened paths to every other-owner port it reaches. */
  private searchFrom(src: PortInfo): number {
    const start = this.cellOf(src);
    const targets = this.ports.filter((p) => p.ownerId !== src.ownerId && !this.cache.has(ShippingPlanner.pairKey(src, p)));
    if (start < 0) { for (const t of targets) this.cache.set(ShippingPlanner.pairKey(src, t), null); return 0; }
    const parent = new Int32Array(GW * GH).fill(-1);
    const queue = new Int32Array(GW * GH);
    let head = 0, tail = 0;
    queue[tail++] = start; parent[start] = start;
    while (head < tail) {
      const c = queue[head++], cx = c % GW, cy = (c - cx) / GW;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const ny = cy + dy; if (ny < 0 || ny >= GH) continue;
        const nx = (cx + dx + GW) % GW, n = ny * GW + nx;
        if (!this.water[n] || parent[n] >= 0) continue;
        parent[n] = c; queue[tail++] = n;
      }
    }
    let found = 0;
    for (const t of targets) {
      const end = this.cellOf(t);
      const key = ShippingPlanner.pairKey(src, t);
      if (end < 0 || parent[end] < 0) { this.cache.set(key, null); continue; }
      const cells: number[] = [];
      for (let c = end; ; c = parent[c]) { cells.push(c); if (c === start) break; }
      cells.reverse(); // src -> t
      const pts = this.straighten(cells, src, t);
      const forward = `${src.x},${src.y}` < `${t.x},${t.y}`;
      this.cache.set(key, forward ? pts : reverse(pts));
      found++;
    }
    return found;
  }

  /** Line-of-sight string pulling over water cells; tile-coordinate waypoints, unwrapped across the date line. */
  private straighten(cells: number[], from: PortInfo, to: PortInfo): number[] {
    // unwrapped cell centres
    const xs: number[] = [], ys: number[] = [];
    let prevX = cells[0] % GW, off = 0;
    for (const c of cells) {
      let cx = c % GW;
      if (cx - prevX > GW / 2) off -= GW; else if (prevX - cx > GW / 2) off += GW;
      prevX = cx; cx += off;
      xs.push(cx); ys.push((c - (c % GW)) / GW);
    }
    const keep = [0];
    let i = 0;
    while (i < cells.length - 1) {
      let j = cells.length - 1;
      while (j > i + 1 && !this.lineOfSight(xs[i], ys[i], xs[j], ys[j])) j--;
      keep.push(j); i = j;
    }
    const pts = [from.x, from.y];
    for (const k of keep.slice(1, -1)) pts.push(xs[k] * CELL + CELL / 2, ys[k] * CELL + CELL / 2);
    // end at the destination port, unwrapped next to the last waypoint
    let ex = to.x;
    const lastX = pts[pts.length - 2];
    while (ex - lastX > WORLD_W / 2) ex -= WORLD_W;
    while (lastX - ex > WORLD_W / 2) ex += WORLD_W;
    pts.push(ex, to.y);
    return pts;
  }

  private lineOfSight(x0: number, y0: number, x1: number, y1: number): boolean {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2;
    for (let s = 0; s <= n; s++) {
      const x = Math.round(x0 + ((x1 - x0) * s) / n), y = Math.round(y0 + ((y1 - y0) * s) / n);
      if (y < 0 || y >= GH || !this.water[y * GW + (((x % GW) + GW) % GW)]) return false;
    }
    return true;
  }
}

function reverse(pts: number[]): number[] {
  const out: number[] = [];
  for (let i = pts.length - 2; i >= 0; i -= 2) out.push(pts[i], pts[i + 1]);
  return out;
}
