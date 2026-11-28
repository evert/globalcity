// Biome art: the Micropolis tile sheet recoloured per terrain variant (see terrain.ts). Micropolis draws all of
// its landscape from a handful of flat colours (dirt, dirt specks, the muddy bank, two waters, two greens), so a
// desert, tundra or snowfield is the same sheet with those colours swapped. Ground colour is swapped on every
// tile, so buildings stand on sand or snow too; specks, banks and leaves only on the landscape tiles; water only
// on tiles that lie on water, and only where it is frozen.
import { Biome, TERRAIN_VARIANTS } from './terrain.ts';
import { PLANET, type Planet } from './planet.ts';
import * as T from './tiles.ts';

type RGB = readonly [number, number, number];
const hex = (h: number): RGB => [(h >> 16) & 255, (h >> 8) & 255, h & 255];

/** The Micropolis colours that make up the landscape. */
export const MP = {
  dirt: 0xcc7f66,
  speck: 0x3f3f3f,
  speck2: 0x000000,
  bank: 0x997f4c,
  water: 0x6666e6,
  waterDark: 0x0000e6,
  leaf: 0x00e600,
  leafDark: 0x007f00,
} as const;

export interface GroundPalette {
  dirt: number;
  speck: number;
  speck2: number;
  bank: number;
  leaf: number;
  leafDark: number;
}

export const GROUND_PALETTES: Record<Biome, GroundPalette> = {
  [Biome.Temperate]: { dirt: MP.dirt, speck: MP.speck, speck2: MP.speck2, bank: MP.bank, leaf: MP.leaf, leafDark: MP.leafDark },
  [Biome.Desert]: { dirt: 0xe6c68a, speck: 0xb8955a, speck2: 0x8c6c3c, bank: 0xc4a066, leaf: 0x8cb43c, leafDark: 0x4c6c1c },
  [Biome.Steppe]: { dirt: 0xb8b47c, speck: 0x7c7c4c, speck2: 0x54542c, bank: 0x989060, leaf: 0x6cbc2c, leafDark: 0x3c6c14 },
  [Biome.Tundra]: { dirt: 0xa8a48c, speck: 0x6c6c5c, speck2: 0x4c4c40, bank: 0x8c8466, leaf: 0x3ca050, leafDark: 0x1c5c2c },
  [Biome.Boreal]: { dirt: 0xe6eaf0, speck: 0xa4aebc, speck2: 0x7c8898, bank: 0xb4bcc8, leaf: 0xdce8e4, leafDark: 0x1c5c3c },
  [Biome.Snow]: { dirt: 0xf6f9fc, speck: 0xc4d2e2, speck2: 0xa4b4cc, bank: 0xc8d6e6, leaf: 0xe6eef0, leafDark: 0x2c6448 },
};
/**
 * The Moon's six biome slots are shades of regolith, dark to bright: Desert, Steppe, Temperate, Tundra, Boreal,
 * Snow (in that order the brighter one wins a border, looks.ts, so bright crater rims fray into the dark maria).
 * tools/src/gen-moon.ts picks a tile's shade from the real albedo and a hillshade. Leaves stay green: what grows on
 * the Moon (parks) grows in a greenhouse.
 */
const grey = (dirt: number, speck: number): GroundPalette => ({ dirt, speck, speck2: speck, bank: speck, leaf: 0x4cc84c, leafDark: 0x247824 });
export const MOON_PALETTES: Record<Biome, GroundPalette> = {
  [Biome.Desert]: grey(0x57544f, 0x403e3a),
  [Biome.Steppe]: grey(0x6c6964, 0x524f4b),
  [Biome.Temperate]: grey(0x84817b, 0x67645f),
  [Biome.Tundra]: grey(0x9b9892, 0x7c7974),
  [Biome.Boreal]: grey(0xb3b0aa, 0x918e89),
  [Biome.Snow]: grey(0xcecbc5, 0xaaa7a1),
};
/** The ground palettes of a planet. */
export const groundPalettes = (planet: Planet = PLANET): Record<Biome, GroundPalette> => (planet === 'moon' ? MOON_PALETTES : GROUND_PALETTES);
export const ICE = { water: 0xd2e6f4, waterDark: 0x9cc4e0 } as const;

/** Tile ids that lie on water (their water pixels freeze): water and shore, bridges, underwater lines, offshore wind. */
export function onWaterId(id: number): boolean {
  return (id >= T.WATER_LOW && id <= T.WATER_HIGH) || T.isOverWater(id) || (id >= T.OFFSHOREBASE && id <= T.LASTOFFSHORE);
}

/** Per variant, a colour map for one tile id: source RGB (packed) -> replacement, or undefined for no change. */
function swapsFor(variant: number, id: number): Map<number, number> {
  const biome = Math.floor(variant / 2) as Biome,
    frozen = (variant & 1) === 1;
  const p = groundPalettes()[biome] ?? GROUND_PALETTES[Biome.Temperate];
  const m = new Map<number, number>();
  m.set(MP.dirt, p.dirt);
  if (id === T.DIRT || id === 1) {
    m.set(MP.speck, p.speck);
    m.set(MP.speck2, p.speck2);
  }
  if (id >= T.REDGE && id <= T.LASTRIVEDGE) m.set(MP.bank, p.bank);
  if (id >= T.WOODS_LOW && id <= T.WOODS5) {
    m.set(MP.leaf, p.leaf);
    m.set(MP.leafDark, p.leafDark);
    m.set(MP.bank, p.bank);
  }
  if (frozen && onWaterId(id)) {
    m.set(MP.water, ICE.water);
    m.set(MP.waterDark, ICE.waterDark);
  }
  for (const [k, v] of m) if (k === v) m.delete(k);
  return m;
}

/**
 * Recolour a copy of the tile sheet's RGBA pixels for one terrain variant (in place). `cols` tiles per row of
 * `tile` px. Variant 0 (temperate, open water) is the sheet as it is, except on the Moon.
 */
export function recolourSheet(px: Uint8ClampedArray | Uint8Array, width: number, height: number, tile: number, variant: number): void {
  if (variant < 0 || variant >= TERRAIN_VARIANTS || (variant === 0 && PLANET !== 'moon')) return;
  const cols = Math.floor(width / tile),
    rows = Math.floor(height / tile);
  for (let ty = 0; ty < rows; ty++)
    for (let tx = 0; tx < cols; tx++) {
      const id = ty * cols + tx;
      const swaps = swapsFor(variant, id);
      if (!swaps.size) continue;
      for (let y = ty * tile; y < ty * tile + tile; y++) {
        let o = (y * width + tx * tile) * 4;
        for (let x = 0; x < tile; x++, o += 4) {
          const c = (px[o] << 16) | (px[o + 1] << 8) | px[o + 2];
          const r = swaps.get(c);
          if (r === undefined) continue;
          px[o] = (r >> 16) & 255;
          px[o + 1] = (r >> 8) & 255;
          px[o + 2] = r & 255;
        }
      }
    }
}

/** Flat colours for the zoomed-out map: ground, its speck, and trees per biome; open water and ice. */
export function biomeMapColours(biome: Biome, planet: Planet = 'earth'): { ground: RGB; speck: RGB; trees: RGB } {
  const p = groundPalettes(planet)[biome] ?? GROUND_PALETTES[Biome.Temperate];
  // boreal and snowy trees read as dark green from afar, not as their white snow caps
  const trees = biome === Biome.Boreal || biome === Biome.Snow ? p.leafDark : p.leaf;
  return { ground: hex(p.dirt), speck: hex(p.speck), trees: hex(trees) };
}
export const ICE_RGB: RGB = hex(ICE.water);
export const ICE_SPECK_RGB: RGB = hex(ICE.waterDark);
