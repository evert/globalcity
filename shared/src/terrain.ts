// The landscape the world was generated with (data/world-*/base.bin, one byte per tile): biome, forest, water,
// frozen. It never changes after generation. The server keeps it next to the tiles: it decides each tile's
// look (looks.ts), whether water is frozen (ships, ports), and what grows back on rubble.

/** Ground palettes. Water tiles carry the biome of the land next to them, so shorelines draw that ground. */
export enum Biome {
  /** Micropolis brown dirt and green trees: temperate and tropical climates (Koppen A and C, warm D) */
  Temperate = 0,
  /** sand, hardly any trees (Koppen BW) */
  Desert = 1,
  /** dry grass and scrub (Koppen BS) */
  Steppe = 2,
  /** treeless, pale grey-green (Koppen ET) */
  Tundra = 3,
  /** snowy ground and snow-laden conifers (subarctic Koppen D*c, D*d) */
  Boreal = 4,
  /** ice sheets and glaciers: Antarctica, Greenland, mountain glaciers, the Antarctic ice shelves (Koppen EF) */
  Snow = 5,
}
export const BIOME_COUNT = 6;
export const BIOME_NAMES: readonly string[] = ['temperate', 'desert', 'steppe', 'tundra', 'boreal', 'snow'];

/** base.bin byte layout */
export const BASE_BIOME_MASK = 0x0f;
/** the tile was generated as forest */
export const BASE_TREES = 0x20;
/** frozen water (only with BASE_WATER): ice for at least half of the year. Still water in the game (bridges,
 *  no zones), but ships can't cross it and it doesn't count as open water for seaports or offshore wind. */
export const BASE_FROZEN = 0x40;
/** the tile was generated as water */
export const BASE_WATER = 0x80;

export const baseBiome = (b: number): Biome => (b & BASE_BIOME_MASK) as Biome;
export const baseIsWater = (b: number): boolean => (b & BASE_WATER) !== 0;
export const baseIsFrozen = (b: number): boolean => (b & (BASE_WATER | BASE_FROZEN)) === (BASE_WATER | BASE_FROZEN);
export const baseIsForest = (b: number): boolean => (b & (BASE_WATER | BASE_TREES)) === BASE_TREES;

/** Biome palettes times frozen or not: the skins of the tile art (see looks.ts and biomeart.ts). */
export const TERRAIN_VARIANTS = BIOME_COUNT * 2;
