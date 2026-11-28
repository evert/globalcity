// The world as a 3D globe (WebGL): the zoomed-out map's own images wrapped around a sphere, lit by the real sun
// (day and night from the actual time), city lights on the night side, and the real clouds when they are on. Drag to
// turn it, scroll or pinch to zoom; zooming in far enough, or double-clicking a spot, hands over to the flat map there.
// One full-screen quad: each pixel works out where its ray meets the sphere, so there is no mesh to build.
import { WORLD_H, WORLD_W, TILE_PX, mapLevels, subsolarPoint } from '@globalcity/shared';
import { MapTileLayer } from './maptiles.ts';
import { sunNow } from './night.ts';
import type { WeatherLayer } from './weather.ts';

/** The map texture: the world at this many pixels across (or the world's own width when smaller). */
const TEX_W = 4096;
/** Globe radius as a share of the smaller screen side when it opens. */
const START_RADIUS = 0.42;
/** Zoomed in past this radius (in screen sides), the globe hands over to the flat map. */
const HANDOVER_RADIUS = 2.2;

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;      // device pixels
uniform vec2 uCentre;   // globe centre, device pixels
uniform float uRadius;  // device pixels
uniform mat3 uRot;      // view -> world
uniform vec3 uSun;      // world, unit
uniform sampler2D uDay, uLights, uClouds;
uniform float uClouds_on;
out vec4 outColor;
const float PI = 3.14159265359;

vec4 sampleSeamless(sampler2D t, float lon, float v) {
  // two parameterisations of longitude, so the date line seam doesn't pick the smallest mipmap
  vec2 a = vec2(fract(lon / (2.0 * PI) + 0.5), v), b = vec2(fract(lon / (2.0 * PI)), v);
  vec2 dax = dFdx(a), day = dFdy(a), dbx = dFdx(b), dby = dFdy(b);
  bool useB = abs(dax.x) + abs(day.x) > abs(dbx.x) + abs(dby.x);
  return useB ? textureGrad(t, vec2(fract(b.x + 0.5), v), dbx, dby) : textureGrad(t, a, dax, day);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 q = (p - uCentre) / uRadius;
  float r2 = dot(q, q);
  vec3 space = vec3(0.012, 0.016, 0.035);
  if (r2 > 1.0) {
    // atmosphere: a thin blue glow just outside the limb
    float d = sqrt(r2) - 1.0;
    float glow = exp(-d * 28.0) * 0.55;
    outColor = vec4(space + vec3(0.35, 0.6, 1.0) * glow, 1.0);
    return;
  }
  float z = sqrt(1.0 - r2);
  vec3 n = normalize(uRot * vec3(q.x, -q.y, z));
  float lat = asin(clamp(n.y, -1.0, 1.0));
  float lon = atan(n.x, n.z);
  float v = 0.5 - lat / PI;
  vec3 col = sampleSeamless(uDay, lon, v).rgb;
  float sun = dot(n, uSun);
  float day = smoothstep(-0.08, 0.12, sun);
  float lambert = 0.55 + 0.45 * clamp(sun * 1.4, 0.0, 1.0);
  vec3 lit = col * lambert;
  vec3 night = col * vec3(0.05, 0.07, 0.14);
  vec4 lights = sampleSeamless(uLights, lon, v);
  night += lights.rgb * lights.a * 0.9;
  col = mix(night, lit, day);
  if (uClouds_on > 0.5) {
    vec4 c = sampleSeamless(uClouds, lon, v);
    vec3 cloud = c.rgb * mix(0.06, 1.0, day);
    col = mix(col, cloud, c.a);
  }
  // limb: a little atmosphere haze towards the edge, brighter on the day side
  float rim = pow(1.0 - z, 3.0);
  col += vec3(0.25, 0.45, 0.9) * rim * (0.15 + 0.6 * day);
  outColor = vec4(col, 1.0);
}`;

export interface GlobeHost {
  /** hand over to the flat map with the camera at this tile and zoom */
  showFlat(tx: number, ty: number, zoom: number): void;
  /** CSS px of the screen */
  cssSize(): { w: number; h: number };
}

export class GlobeView {
  readonly canvas = document.createElement('canvas');
  private readonly gl: WebGL2RenderingContext | null;
  private prog: WebGLProgram | null = null;
  private tex: { day: WebGLTexture; lights: WebGLTexture; clouds: WebGLTexture } | null = null;
  private readonly tiles = new MapTileLayer();
  private readonly dayCanvas = document.createElement('canvas');
  private readonly lightsCanvas = document.createElement('canvas');
  private texVersion = -1;
  private cloudVersion = -1;
  private uploadTimer: ReturnType<typeof setTimeout> | null = null;
  /** the point at the centre of the view, radians, and the radius in CSS px */
  private lon = 0;
  private lat = 0.35;
  private radius = 300;
  private shown = false;
  private scheduled = false;
  onClose: () => void = () => {};

  constructor(
    after: HTMLElement,
    private readonly host: GlobeHost,
    private readonly weather: WeatherLayer,
  ) {
    Object.assign(this.canvas.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', display: 'none', touchAction: 'none', cursor: 'grab' });
    after.after(this.canvas);
    this.gl = this.canvas.getContext('webgl2', { antialias: true, alpha: false });
    this.tiles.onUpdate = () => this.scheduleUpload();
    weather.subscribe(() => this.invalidate());
    this.bindInput();
    setInterval(() => this.invalidate(), 60_000); // the sun moves
    window.addEventListener('resize', () => this.invalidate());
  }

  get supported(): boolean {
    return this.gl !== null;
  }
  get isShown(): boolean {
    return this.shown;
  }

  /** Open the globe centred on a tile. */
  show(tx: number, ty: number): void {
    if (!this.gl) return;
    this.lon = (tx / WORLD_W) * 2 * Math.PI - Math.PI;
    this.lat = Math.max(-1.2, Math.min(1.2, (0.5 - ty / WORLD_H) * Math.PI));
    const { w, h } = this.host.cssSize();
    this.radius = Math.min(w, h) * START_RADIUS;
    this.shown = true;
    this.canvas.style.display = 'block';
    this.tiles.maybeRefresh();
    this.compose();
    this.invalidate();
  }

  hide(): void {
    this.shown = false;
    this.canvas.style.display = 'none';
  }

  // ---------- textures ----------
  private texSize(): { w: number; h: number; level: number } {
    const w = Math.min(TEX_W, WORLD_W);
    const level = Math.min(mapLevels() - 1, Math.max(0, Math.round(Math.log2(WORLD_W / w))));
    return { w: WORLD_W >> level, h: WORLD_H >> level, level };
  }

  /** Draw the map images into the texture canvases (missing regions come from coarser levels meanwhile). */
  private compose(): void {
    const { w, h, level } = this.texSize();
    for (const c of [this.dayCanvas, this.lightsCanvas])
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
    const view = { x: (tx: number) => (tx / WORLD_W) * w, y: (ty: number) => (ty / WORLD_H) * h };
    const dg = this.dayCanvas.getContext('2d')!;
    dg.imageSmoothingEnabled = false;
    this.tiles.draw(dg, 'day', level, view, 0, 0, w, h);
    const lg = this.lightsCanvas.getContext('2d')!;
    lg.clearRect(0, 0, w, h);
    lg.imageSmoothingEnabled = false;
    this.tiles.draw(lg, 'lights', level, view, 0, 0, w, h);
  }

  /** New map images arrived: recompose and upload, at most every half second. */
  private scheduleUpload(): void {
    if (!this.shown || this.uploadTimer) return;
    this.uploadTimer = setTimeout(() => {
      this.uploadTimer = null;
      if (!this.shown) return;
      this.compose();
      this.invalidate();
    }, 500);
  }

  private initGl(gl: WebGL2RenderingContext): boolean {
    const sh = (type: number, src: string): WebGLShader | null => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.warn('[globe] shader:', gl.getShaderInfoLog(s));
        return null;
      }
      return s;
    };
    const vs = sh(gl.VERTEX_SHADER, VERT),
      fs = sh(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return false;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('[globe] link:', gl.getProgramInfoLog(prog));
      return false;
    }
    this.prog = prog;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const mk = (): WebGLTexture => {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
      return t;
    };
    this.tex = { day: mk(), lights: mk(), clouds: mk() };
    return true;
  }

  private upload(gl: WebGL2RenderingContext, t: WebGLTexture, src: TexImageSource): void {
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  // ---------- drawing ----------
  invalidate(): void {
    if (!this.shown || this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => {
      this.scheduled = false;
      this.draw();
    });
  }

  private draw(): void {
    const gl = this.gl;
    if (!gl || !this.shown) return;
    if (!this.prog && !this.initGl(gl)) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const { w: cssW, h: cssH } = this.host.cssSize();
    const W = Math.round(cssW * dpr),
      H = Math.round(cssH * dpr);
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    const tex = this.tex!;
    if (this.texVersion !== this.tiles.version) {
      this.texVersion = this.tiles.version;
      this.upload(gl, tex.day, this.dayCanvas);
      this.upload(gl, tex.lights, this.lightsCanvas);
    }
    if (this.cloudVersion !== this.weather.version && this.weather.ready) {
      this.cloudVersion = this.weather.version;
      this.upload(gl, tex.clouds, this.weather.clouds);
    }
    gl.viewport(0, 0, W, H);
    gl.useProgram(this.prog);
    const u = (n: string) => gl.getUniformLocation(this.prog!, n);
    gl.uniform2f(u('uRes'), W, H);
    gl.uniform2f(u('uCentre'), W / 2, H / 2);
    gl.uniform1f(u('uRadius'), this.radius * dpr);
    // view -> world: turn by latitude about x, then by longitude about y (column-major)
    const cl = Math.cos(this.lon),
      sl = Math.sin(this.lon),
      ca = Math.cos(-this.lat),
      sa = Math.sin(-this.lat);
    // Ry(lon) * Rx(-lat)
    const m = [cl, 0, -sl, sl * sa, ca, cl * sa, sl * ca, -sa, cl * ca];
    gl.uniformMatrix3fv(u('uRot'), false, m);
    const s = subsolarPoint(sunNow());
    const slat = (s.lat * Math.PI) / 180,
      slon = (s.lon * Math.PI) / 180;
    gl.uniform3f(u('uSun'), Math.cos(slat) * Math.sin(slon), Math.sin(slat), Math.cos(slat) * Math.cos(slon));
    const bind = (unit: number, t: WebGLTexture, name: string) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.uniform1i(u(name), unit);
    };
    bind(0, tex.day, 'uDay');
    bind(1, tex.lights, 'uLights');
    bind(2, tex.clouds, 'uClouds');
    gl.uniform1f(u('uClouds_on'), this.weather.cloudsShown ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.tiles.maybeRefresh();
  }

  // ---------- input ----------
  /** The tile under a screen point (CSS px), or null off the globe. */
  private pick(cx: number, cy: number): { tx: number; ty: number } | null {
    const { w, h } = this.host.cssSize();
    const qx = (cx - w / 2) / this.radius,
      qy = (cy - h / 2) / this.radius;
    const r2 = qx * qx + qy * qy;
    if (r2 > 1) return null;
    const vx = qx,
      vy = -qy,
      vz = Math.sqrt(1 - r2);
    // same rotation as the shader
    const cl = Math.cos(this.lon),
      sl = Math.sin(this.lon),
      ca = Math.cos(-this.lat),
      sa = Math.sin(-this.lat);
    const y1 = vy * ca - vz * sa,
      z1 = vy * sa + vz * ca;
    const nx = vx * cl + z1 * sl,
      ny = y1,
      nz = -vx * sl + z1 * cl;
    const lat = Math.asin(Math.max(-1, Math.min(1, ny))),
      lon = Math.atan2(nx, nz);
    return { tx: ((lon + Math.PI) / (2 * Math.PI)) * WORLD_W, ty: (0.5 - lat / Math.PI) * WORLD_H };
  }

  /** Flat-map zoom with the same scale as the globe's centre (tiles per CSS px at the equator of the view). */
  private flatZoom(): number {
    return (this.radius * 2 * Math.PI) / WORLD_W / TILE_PX;
  }

  private zoomBy(f: number): void {
    const { w, h } = this.host.cssSize();
    const side = Math.min(w, h);
    this.radius = Math.max(side * 0.2, this.radius * f);
    if (this.radius > side * HANDOVER_RADIUS) {
      const c = this.pick(w / 2, h / 2)!;
      this.host.showFlat(c.tx, c.ty, this.flatZoom());
      return;
    }
    this.invalidate();
  }

  private bindInput(): void {
    const c = this.canvas;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      c.style.cursor = 'grabbing';
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    c.addEventListener('pointermove', (e) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      if (pointers.size === 2) {
        p.x = e.clientX;
        p.y = e.clientY;
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0) this.zoomBy(d / pinch);
        pinch = d;
        return;
      }
      const dx = e.clientX - p.x,
        dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      this.lon -= dx / this.radius;
      this.lat = Math.max(-1.45, Math.min(1.45, this.lat + dy / this.radius));
      this.invalidate();
    });
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = 0;
      if (!pointers.size) c.style.cursor = 'grab';
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoomBy(Math.exp(-e.deltaY * 0.0015));
      },
      { passive: false },
    );
    c.addEventListener('dblclick', (e) => {
      const t = this.pick(e.clientX, e.clientY);
      if (t) this.host.showFlat(t.tx, t.ty, Math.max(this.flatZoom() * 4, 0.06));
    });
  }
}
