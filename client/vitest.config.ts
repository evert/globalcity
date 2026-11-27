// Client tests: pure logic, no server and no browser (client/src/selftest.ts is the in-browser one, #selftest).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'client',
    include: ['test/**/*.test.ts'],
  },
});
