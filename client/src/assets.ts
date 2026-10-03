// Asset loading: the Micropolis sprite sheet and the world minimap, each with a
// procedural fallback so the client keeps working when the files are missing.
import * as T from '@globalcity/shared';
import { TILE_PX, LIGHTNINGBOLT, TILE_COUNT } from '@globalcity/shared';

export interface SpriteSheet {
  image: CanvasImageSource;
  cols: number;
  tileSize: number;
  count: number;
  procedural: boolean;
}

export interface Minimap {
  image: CanvasImageSource;
  width: number;
  height: number;
  procedural: boolean;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${url}`));
    img.src = url;
  });
}

export async function loadSpriteSheet(url = '/assets/micropolis/tiles.png'): Promise<SpriteSheet> {
  try {
    const img = await loadImage(url);
    const cols = Math.max(1, Math.floor(img.naturalWidth / TILE_PX));
    const rows = Math.floor(img.naturalHeight / TILE_PX);
    if (cols * rows < 1) throw new Error('sprite sheet too small');
    return { image: img, cols, tileSize: TILE_PX, count: cols * rows, procedural: false };
  } catch (e) {
    console.warn('[assets] using procedural sprite sheet:', (e as Error).message);
    return proceduralSheet();
  }
}

export async function loadMinimap(url = '/assets/world-minimap.png'): Promise<Minimap> {
  try {
    const img = await loadImage(url);
    return { image: img, width: img.naturalWidth, height: img.naturalHeight, procedural: false };
  } catch (e) {
    console.warn('[assets] using procedural minimap:', (e as Error).message);
    return proceduralMinimap();
  }
}

/** Colour class for a tile id, used by the procedural sheet. */
export function tileClassColor(id: number): string {
  if (id === T.DIRT || id === 1) return '#7a6a45';
  if (id >= T.WATER_LOW && id <= T.WATER_HIGH) return id === T.RIVER || id === T.CHANNEL ? '#1f4f8f' : '#2b63a8';
  if (id >= T.WOODS_LOW && id <= T.WOODS5) return id >= T.WOODS ? '#1f6a2a' : '#2e7d32';
  if (id >= T.RUBBLE && id <= T.LASTRUBBLE) return '#8a7f6a';
  if (id >= T.FLOOD && id <= T.LASTFLOOD) return '#6fa8dc';
  if (id === T.RADTILE) return '#9c27b0';
  if (id >= T.FIRE && id <= T.LASTFIRE) return '#ff6f00';
  if (id >= T.ROADBASE && id <= T.LASTROAD) return id >= T.HTRFBASE ? '#3a3a3a' : '#5b5b5b';
  if (id >= T.POWER_LOW && id <= T.POWER_HIGH) return '#c9a227';
  if (id >= T.RAIL_LOW && id <= T.RAIL_HIGH) return '#4a4036';
  if (id >= T.RESBASE && id <= T.HOSPITALBASE - 1) return id >= T.HOUSE && id <= T.HHTHR ? '#8bc34a' : '#5aa849';
  if (id >= T.HOSPITALBASE && id <= T.CHURCHBASE + 8) return '#e0e0e0';
  if (id >= T.COMBASE && id <= T.COMLAST) return '#4e78c4';
  if (id >= T.INDBASE && id <= T.INDLAST) return '#c9b037';
  if (id >= T.PORTBASE && id <= T.LASTPORT) return '#3f9c9c';
  if (id >= T.AIRPORTBASE && id <= T.LASTAIRPORT) return '#9e9e9e';
  if (id >= T.COALBASE && id <= T.LASTPOWERPLANT) return '#555555';
  if (id >= T.FIRESTBASE && id <= T.FIRESTBASE + 8) return '#d32f2f';
  if (id >= T.POLICESTBASE && id <= T.POLICESTBASE + 8) return '#283593';
  if (id >= T.STADIUMBASE && id <= T.FULLSTADIUMBASE + 15) return '#2e8b57';
  if (id >= T.NUCLEARBASE && id <= T.LASTZONE) return '#e6d96a';
  if (id === LIGHTNINGBOLT) return '#ffeb3b';
  if (id >= T.SMOKEBASE && id < T.TINYEXP) return '#9e9e9e';
  if (id >= T.TINYEXP && id <= T.TINYEXPLAST) return '#ff8f00';
  return '#6d4c41';
}

/** Procedural 32-column sprite sheet: coloured squares by tile class with a few cheap glyphs. */
export function proceduralSheet(): SpriteSheet {
  const cols = 32;
  const rows = Math.ceil(TILE_COUNT / cols);
  const c = document.createElement('canvas');
  c.width = cols * TILE_PX;
  c.height = rows * TILE_PX;
  const g = c.getContext('2d')!;
  for (let id = 0; id < TILE_COUNT; id++) {
    const x = (id % cols) * TILE_PX;
    const y = Math.floor(id / cols) * TILE_PX;
    g.fillStyle = tileClassColor(id);
    g.fillRect(x, y, TILE_PX, TILE_PX);
    // subtle inner shade so neighbouring tiles of the same class are distinguishable
    g.fillStyle = id % 2 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)';
    g.fillRect(x + 1, y + 1, TILE_PX - 2, TILE_PX - 2);
    if (id >= T.ROADBASE && id <= T.LASTROAD) {
      g.fillStyle = '#d8d8a0';
      const k = (id - T.ROADBASE) % 16;
      if (k === 2 || k === 0) g.fillRect(x + 2, y + 7, 12, 2);
      else if (k === 3 || k === 1) g.fillRect(x + 7, y + 2, 2, 12);
      else g.fillRect(x + 6, y + 6, 4, 4);
    } else if (id >= T.POWER_LOW && id <= T.POWER_HIGH) {
      g.fillStyle = '#7a6a45';
      g.fillRect(x, y, TILE_PX, TILE_PX);
      g.fillStyle = '#ffd54f';
      if (id === T.LHPOWER || id === T.HPOWER) g.fillRect(x, y + 7, 16, 2);
      else if (id === T.LVPOWER || id === T.VPOWER) g.fillRect(x + 7, y, 2, 16);
      else { g.fillRect(x + 7, y + 3, 2, 10); g.fillRect(x + 3, y + 7, 10, 2); }
    } else if (id >= T.RAIL_LOW && id <= T.RAIL_HIGH) {
      g.fillStyle = '#7a6a45';
      g.fillRect(x, y, TILE_PX, TILE_PX);
      g.fillStyle = '#4a4036';
      if (id === T.LHRAIL || id === T.HRAIL) { g.fillRect(x, y + 5, 16, 2); g.fillRect(x, y + 9, 16, 2); }
      else if (id === T.LVRAIL || id === T.VRAIL) { g.fillRect(x + 5, y, 2, 16); g.fillRect(x + 9, y, 2, 16); }
      else g.fillRect(x + 4, y + 4, 8, 8);
    } else if (id === LIGHTNINGBOLT) {
      g.clearRect(x, y, TILE_PX, TILE_PX);
      g.fillStyle = '#ffeb3b';
      g.beginPath();
      g.moveTo(x + 9, y + 1); g.lineTo(x + 4, y + 9); g.lineTo(x + 8, y + 9);
      g.lineTo(x + 6, y + 15); g.lineTo(x + 12, y + 6); g.lineTo(x + 8, y + 6); g.closePath();
      g.fill();
    } else if (id >= T.WOODS_LOW && id <= T.WOODS5) {
      g.fillStyle = '#144d1c';
      g.beginPath(); g.arc(x + 8, y + 8, 5, 0, Math.PI * 2); g.fill();
    } else if (T.zoneSizeForCenter(id) > 0) {
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(x + 4, y + 4, 8, 8);
    }
  }
  return { image: c, cols, tileSize: TILE_PX, count: TILE_COUNT, procedural: true };
}

/** Procedural minimap: dark ocean with a faint graticule. */
export function proceduralMinimap(): Minimap {
  const w = 2048, h = 1024;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0b1e3a';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(255,255,255,0.08)';
  g.lineWidth = 1;
  for (let lon = -180; lon <= 180; lon += 30) {
    const x = Math.round(((lon + 180) / 360) * w) + 0.5;
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
  }
  for (let lat = -90; lat <= 90; lat += 30) {
    const y = Math.round(((90 - lat) / 180) * h) + 0.5;
    g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
  }
  return { image: c, width: w, height: h, procedural: true };
}

/** Draw one tile from the sheet at (dx,dy) with size dw x dh. */
export function drawTile(g: CanvasRenderingContext2D, sheet: SpriteSheet, id: number, dx: number, dy: number, dw = TILE_PX, dh = TILE_PX): void {
  if (id < 0 || id >= sheet.count) id = 0;
  const ts = sheet.tileSize;
  const sx = (id % sheet.cols) * ts;
  const sy = Math.floor(id / sheet.cols) * ts;
  g.drawImage(sheet.image, sx, sy, ts, ts, dx, dy, dw, dh);
}
