// World generator tests: check the generated world's files (tools/test/world.test.ts). Skipped, with a note, when
// there is no generated world (WORLD_DIR picks another one to check).
//   npm test -w tools
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { EARTH_H, EARTH_W } from '../shared/src/constants.ts';

const root = path.resolve(import.meta.dirname, '..');
const dir = path.resolve(root, process.env.WORLD_DIR || `data/world-${EARTH_W}x${EARTH_H}`);
if (!fs.existsSync(path.join(dir, 'base.bin')))
  console.warn(`\n  World generator tests skipped: no generated world in ${path.relative(root, dir)} (npm run gen:world makes one)\n`);

export default defineConfig({
  test: {
    name: 'world',
    include: ['test/**/*.test.ts'],
  },
});
