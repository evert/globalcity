import { WORLD_W, WORLD_H, CHUNK } from './constants.ts';

/** Equirectangular: lon -180..180 -> x 0..WORLD_W, lat 90..-90 -> y 0..WORLD_H */
export function lonLatToTile(lon: number, lat: number): { x: number; y: number } {
  const x = Math.floor(((lon + 180) / 360) * WORLD_W);
  const y = Math.floor(((90 - lat) / 180) * WORLD_H);
  return { x: clamp(x, 0, WORLD_W - 1), y: clamp(y, 0, WORLD_H - 1) };
}

export function tileToLonLat(x: number, y: number): { lon: number; lat: number } {
  return { lon: (x / WORLD_W) * 360 - 180, lat: 90 - (y / WORLD_H) * 180 };
}

export function chunkOf(x: number, y: number): { cx: number; cy: number } {
  return { cx: Math.floor(x / CHUNK), cy: Math.floor(y / CHUNK) };
}

export function chunkKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

export function parseChunkKey(key: string): { cx: number; cy: number } {
  const [a, b] = key.split(',');
  return { cx: Number(a), cy: Number(b) };
}

export function inWorld(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < WORLD_W && y < WORLD_H;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
