// A satellite circling the globe view: an ISS-like orbit (51.6 degrees inclined, the ground track drifting west a
// little each lap as the Earth turns under it), sped up so it laps the planet in a couple of minutes, and lifted
// well above the surface so it reads at globe size. It glints in sunlight and goes dark in the Earth's shadow, slips
// behind the planet and comes round the limb again. Drawn on a canvas of its own over the globe, so the globe
// itself isn't redrawn every frame for it.
import { subsolarPoint } from '@globalcity/shared';
import { sunNow } from './night.ts';

/** One lap, ms (the real ISS takes ~92 minutes). */
const PERIOD_MS = 120_000;
const INCLINATION = (51.6 * Math.PI) / 180;
/** The ground track moves this far west per lap (the ISS: ~22.9 degrees). */
const DRIFT_PER_LAP = (22.9 * Math.PI) / 180;
/** Orbit radius in Earth radii (the ISS is at ~1.06; more, so it shows). */
const ORBIT_R = 1.16;

type V3 = [number, number, number];

/** Pixel art, one character per pixel: P panel, p panel grid, B body, b body shade, A antenna. */
const ART = ['     A     ', 'PPpP BB PpPP', 'PpPP Bb PPpP', 'PPpP BB PpPP'];
const COLOURS: Record<string, string> = { P: '#3d5fd4', p: '#22357e', B: '#e8c25a', b: '#a8822a', A: '#d8d8d8' };

/** Where the satellite is at `ms` (world coordinates, unit = Earth radius; y north, lon 0 at +z, east towards +x). */
export function satellitePosition(ms: number): V3 {
  const laps = ms / PERIOD_MS;
  const u = 2 * Math.PI * (laps % 1);
  const node = -DRIFT_PER_LAP * laps; // longitude of the ascending node
  const e1: V3 = [Math.sin(node), 0, Math.cos(node)]; // on the equator at the node
  const east: V3 = [Math.cos(node), 0, -Math.sin(node)];
  const e2: V3 = [Math.cos(INCLINATION) * east[0], Math.sin(INCLINATION), Math.cos(INCLINATION) * east[2]];
  const c = Math.cos(u),
    s = Math.sin(u);
  return [ORBIT_R * (c * e1[0] + s * e2[0]), ORBIT_R * (c * e1[1] + s * e2[1]), ORBIT_R * (c * e1[2] + s * e2[2])];
}

export interface GlobeCamera {
  /** world -> screen: CSS px and depth toward the viewer (view z) */
  project(p: V3): { x: number; y: number; z: number };
  /** globe radius, CSS px */
  radius: number;
}

export class Satellite {
  readonly canvas = document.createElement('canvas');
  private readonly g = this.canvas.getContext('2d')!;
  private running = false;
  private readonly sprite = document.createElement('canvas');

  constructor(
    after: HTMLElement,
    private readonly camera: () => GlobeCamera | null,
  ) {
    Object.assign(this.canvas.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', pointerEvents: 'none', display: 'none' });
    this.canvas.setAttribute('aria-hidden', 'true');
    after.after(this.canvas);
    const w = Math.max(...ART.map((r) => r.length));
    this.sprite.width = w;
    this.sprite.height = ART.length;
    const sg = this.sprite.getContext('2d')!;
    ART.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        if (!COLOURS[ch]) return;
        sg.fillStyle = COLOURS[ch];
        sg.fillRect(x, y, 1, 1);
      }),
    );
  }

  start(): void {
    this.canvas.style.display = 'block';
    if (this.running) return;
    this.running = true;
    requestAnimationFrame(() => this.frame());
  }
  stop(): void {
    this.running = false;
    this.canvas.style.display = 'none';
  }

  private frame(): void {
    if (!this.running) return;
    const cam = this.camera();
    const dpr = Math.min(2, devicePixelRatio || 1);
    const cw = Math.round(innerWidth * dpr),
      ch = Math.round(innerHeight * dpr);
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cw, ch);
    if (cam && !document.hidden) {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.draw(g, cam, Date.now());
    }
    requestAnimationFrame(() => this.frame());
  }

  /** In front of the globe, or beside it (not hidden behind the planet)? */
  private visible(cam: GlobeCamera, q: { x: number; y: number; z: number }, centre: { x: number; y: number }): boolean {
    if (q.z > 0) return true;
    const dx = (q.x - centre.x) / cam.radius,
      dy = (q.y - centre.y) / cam.radius;
    return dx * dx + dy * dy > 1;
  }

  private draw(g: CanvasRenderingContext2D, cam: GlobeCamera, now: number): void {
    const centre = cam.project([0, 0, 0]);
    // the orbit: a faint line where it isn't hidden by the planet, a lap either side of now
    g.strokeStyle = 'rgba(190, 215, 255, 0.22)';
    g.lineWidth = 1;
    g.beginPath();
    let pen = false;
    for (let k = 0; k <= 160; k++) {
      const q = cam.project(satellitePosition(now + ((k - 80) / 160) * PERIOD_MS));
      if (!this.visible(cam, q, centre)) {
        pen = false;
        continue;
      }
      if (pen) g.lineTo(q.x, q.y);
      else g.moveTo(q.x, q.y);
      pen = true;
    }
    g.stroke();

    const p = satellitePosition(now);
    const q = cam.project(p);
    if (!this.visible(cam, q, centre)) return;
    // in the Earth's shadow: on the night side and within the shadow cylinder behind the planet
    const s = subsolarPoint(sunNow());
    const la = (s.lat * Math.PI) / 180,
      lo = (s.lon * Math.PI) / 180;
    const sun: V3 = [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)];
    const along = p[0] * sun[0] + p[1] * sun[1] + p[2] * sun[2];
    const off2 = p[0] ** 2 + p[1] ** 2 + p[2] ** 2 - along * along;
    const lit = along > 0 || off2 > 1;
    const scale = Math.max(1, Math.round(cam.radius / 110));
    const w = this.sprite.width * scale,
      h = this.sprite.height * scale;
    g.imageSmoothingEnabled = false;
    g.globalAlpha = lit ? 1 : 0.45;
    g.drawImage(this.sprite, Math.round(q.x - w / 2), Math.round(q.y - h / 2), w, h);
    g.globalAlpha = 1;
    if (lit) {
      // a glint that pulses as the panels catch the sun
      const glint = 0.35 + 0.35 * Math.sin(now / 400);
      const r = 3 * scale;
      const grad = g.createRadialGradient(q.x, q.y, 0, q.x, q.y, r * 2);
      grad.addColorStop(0, `rgba(255, 255, 230, ${glint})`);
      grad.addColorStop(1, 'rgba(255, 255, 230, 0)');
      g.fillStyle = grad;
      g.fillRect(q.x - r * 2, q.y - r * 2, r * 4, r * 4);
    }
  }
}
