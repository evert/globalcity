// Builds client/public/assets/micropolis/skins.png: every tile of tiles.png in every look (shared/src/looks.ts).
//   - each biome: the whole sheet in that biome's colours (shared/src/biomeart.ts), buildings included
//   - frozen: the tiles that lie on water, iced over, per biome
//   - ground transitions: bare ground and trees of one biome with some corners frayed into another
//   - ice transitions: frozen water with some corners open
// Run after art/sheet/build_sheet.py whenever tiles.png or the palettes change:  npm run gen:sheet -w tools
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TILE_PX, SHEET_COLS, SHEET_TILES, SKIN_COUNT, recolourSheet, describeLook, sheetEntries } from '@globalcity/shared';
import { readPng, writePngRgb } from './png.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = resolve(ROOT, 'client/public/assets/micropolis/tiles.png');
const OUT = resolve(ROOT, 'client/public/assets/micropolis/skins.png');
const T = TILE_PX;

const base = readPng(readFileSync(SRC));
const srcCols = base.w / T;
// the sheet in each skin (biome * 2 + frozen)
const skins: Uint8Array[] = [];
for (let s = 0; s < SKIN_COUNT; s++) {
  const px = base.px.slice();
  recolourSheet(px, base.w, base.h, T, s);
  skins.push(px);
}

// How much of a tile belongs to its frayed corners, per pixel: 1 at a corner, fading to 0 about two thirds of
// the way along the edges, turned into pixels with an ordered dither (the Micropolis way of shading).
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const CORNERS: [number, number][] = [
  [T, 0],
  [T, T],
  [0, T],
  [0, 0],
]; // NE, SE, SW, NW
const R_FULL = T * 0.45,
  R_NONE = T * 0.8;
function inCorners(mask: number, x: number, y: number): boolean {
  let w = 0;
  for (let c = 0; c < 4; c++) {
    if (!(mask & (1 << c))) continue;
    const d = Math.hypot(x + 0.5 - CORNERS[c][0], y + 0.5 - CORNERS[c][1]);
    w = Math.max(w, Math.min(1, Math.max(0, (R_NONE - d) / (R_NONE - R_FULL))));
  }
  return (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16 < w;
}

const rows = Math.ceil(SHEET_TILES / SHEET_COLS);
const out = { w: SHEET_COLS * T, h: rows * T, px: new Uint8Array(SHEET_COLS * T * rows * T * 4) };
function copyTile(from: Uint8Array, kind: number, to: number, mask = 0, cornerFrom: Uint8Array | null = null): void {
  const sx = (kind % srcCols) * T,
    sy = Math.floor(kind / srcCols) * T;
  const dx = (to % SHEET_COLS) * T,
    dy = Math.floor(to / SHEET_COLS) * T;
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      const src = cornerFrom && inCorners(mask, x, y) ? cornerFrom : from;
      const s = ((sy + y) * base.w + sx + x) * 4,
        d = ((dy + y) * out.w + dx + x) * 4;
      out.px[d] = src[s];
      out.px[d + 1] = src[s + 1];
      out.px[d + 2] = src[s + 2];
      out.px[d + 3] = 255;
    }
}

let n = 0;
for (const { index, look, kind } of sheetEntries()) {
  if (kind >= srcCols * (base.h / T)) continue;
  const d = describeLook(look);
  if (d.kind === 'skin') copyTile(skins[d.biome * 2 + (d.frozen ? 1 : 0)], kind, index);
  else if (d.kind === 'ground') copyTile(skins[d.a * 2], kind, index, d.mask, skins[d.b * 2]);
  else copyTile(skins[d.biome * 2 + 1], kind, index, d.mask, skins[d.biome * 2]);
  n++;
}
writeFileSync(OUT, writePngRgb(out));
console.log(`wrote ${OUT}: ${out.w}x${out.h}, ${n} tiles`);
