// Every test: `npm test` (each workspace also runs its own with `npm test -w <name>`).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['shared', 'client', 'server', 'tools'],
  },
});
