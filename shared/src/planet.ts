// Which planet the world is: the Earth, or the Moon (base.json "planet", docs/world-format.md). The server sets it at
// boot and sends it in the welcome, like the world's size. On the Moon the sun follows the lunar day (a month long),
// night falls at once (no air to scatter the light), the ground is six shades of regolith (biomeart.ts), there is no
// weather, and cities are moon bases (the client's names and domes). A live binding: read it when needed.
import { configureMoonTools } from './tools.ts';

export type Planet = 'earth' | 'moon';
export let PLANET: Planet = 'earth';
export const PLANETS: readonly Planet[] = ['earth', 'moon'];
/** Set the planet (once at boot, before anything shows a tool's name). */
export function configurePlanet(p: unknown): void {
  if (p !== 'moon' || PLANET === 'moon') return;
  PLANET = 'moon';
  configureMoonTools();
}
export const onMoon = (): boolean => PLANET === 'moon';
