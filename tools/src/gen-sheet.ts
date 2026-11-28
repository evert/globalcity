// Builds client/public/assets/micropolis/skins.png: every tile of tiles.png in every look (shared/src/looks.ts).
//   - each biome: the whole sheet in that biome's colours (shared/src/biomeart.ts), buildings included
//   - frozen: the tiles that lie on water, iced over, per biome
//   - ground transitions: bare ground and trees of one biome with some corners frayed into another
//   - ice transitions: frozen water with some corners open
// Run after art/sheet/build_sheet.py whenever tiles.png or the palettes change:  npm run gen:sheet -w tools
// PLANET=moon builds the Moon's sheet, skins-moon.png, in the regolith palettes.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TILE_PX,
  SHEET_COLS,
  SHEET_TILES,
  SKIN_COUNT,
  WINDBASE,
  recolourSheet,
  describeLook,
  sheetEntries,
  configurePlanet,
  groundPalettes,
  PLANET,
  type Biome,
} from '@globalcity/shared';
import { readPng, writePngRgb } from './png.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = resolve(ROOT, 'client/public/assets/micropolis/tiles.png');
configurePlanet(process.env.PLANET);
const OUT = resolve(ROOT, `client/public/assets/micropolis/${PLANET === 'moon' ? 'skins-moon' : 'skins'}.png`);
const T = TILE_PX;

const base = readPng(readFileSync(SRC));
const srcCols = base.w / T;
// the sheet in each skin (biome * 2 + frozen)
const skins: Uint8Array[] = [];
for (let s = 0; s < SKIN_COUNT; s++) {
  const px = base.px.slice();
  recolourSheet(px, base.w, base.h, T, s);
  if (PLANET === 'moon') paintSolarArray(px, groundPalettes()[(s >> 1) as Biome].dirt);
  skins.push(px);
}

/**
 * The Moon's wind farm is a solar array (shared/src/tools.ts, configureMoonTools): the 4x4 wind farm tiles redrawn
 * as four rows of panels on the regolith, tilted toward the sun, each row casting a short shadow, with an inverter
 * hut in the corner. Drawn in the Micropolis way: flat colours, a light top edge, dark cell lines.
 */
function paintSolarArray(px: Uint8Array, ground: number): void {
  const S = 4 * T; // the farm is 4x4 tiles
  const put = (x: number, y: number, c: number) => {
    const k = WINDBASE + Math.floor(y / T) * 4 + Math.floor(x / T);
    const o = ((Math.floor(k / srcCols) * T + (y % T)) * base.w + (k % srcCols) * T + (x % T)) * 4;
    px[o] = (c >> 16) & 255;
    px[o + 1] = (c >> 8) & 255;
    px[o + 2] = c & 255;
  };
  const PANEL = 0x23356e,
    CELL = 0x4766b0,
    EDGE = 0xa8bce8,
    FRAME = 0x6c6c74,
    SHADOW = 0x34322f;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) put(x, y, ground);
  // four rows of panels, 11 px deep with 5 px between rows
  for (let r = 0; r < 4; r++) {
    const y0 = 3 + r * 15;
    const x0 = 3,
      x1 = r === 3 ? S - 18 : S - 4; // the last row leaves room for the hut
    for (let y = y0; y < y0 + 11; y++)
      for (let x = x0; x < x1; x++) {
        const edge = y === y0,
          frame = x === x0 || x === x1 - 1 || y === y0 + 10;
        const cell = (x - x0) % 6 === 5 || (y - y0) % 4 === 3;
        put(x, y, edge ? EDGE : frame ? FRAME : cell ? CELL : PANEL);
      }
    for (let y = y0 + 11; y < y0 + 13; y++) for (let x = x0 + 1; x < x1; x++) put(x, y, SHADOW);
  }
  // the inverter hut: a little white box with a dark door and a shadow
  for (let y = S - 15; y < S - 4; y++)
    for (let x = S - 14; x < S - 3; x++) put(x, y, y === S - 15 ? 0xffffff : x === S - 14 || x === S - 4 ? 0xa0a0a8 : 0xdcdce4);
  for (let y = S - 10; y < S - 4; y++) for (let x = S - 10; x < S - 7; x++) put(x, y, 0x3c3c46);
  for (let y = S - 4; y < S - 2; y++) for (let x = S - 13; x < S - 2; x++) put(x, y, SHADOW);
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
