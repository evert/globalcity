// What drives the climate model (shared/src/climate.ts) once a game year: the coal plants and industrial zones
// standing on claimed plots, frozen cities included (like the world stats, their plants keep running).
import { CHUNK, WORLD_W, LOMASK, ZONEBIT, POWERPLANT, isIndZone, parseChunkKey } from '@globalcity/shared';
import type { World } from './world.ts';

export function countEmitters(world: World, claimKeys: Iterable<string>): { coal: number; industry: number } {
  const t = world.tiles;
  let coal = 0,
    industry = 0;
  for (const key of claimKeys) {
    const { cx, cy } = parseChunkKey(key);
    for (let y = cy * CHUNK; y < cy * CHUNK + CHUNK; y++) {
      const row = y * WORLD_W;
      for (let x = cx * CHUNK; x < cx * CHUNK + CHUNK; x++) {
        const v = t[row + x];
        if (!(v & ZONEBIT)) continue;
        if ((v & LOMASK) === POWERPLANT) coal++;
        else if (isIndZone(v)) industry++;
      }
    }
  }
  return { coal, industry };
}
