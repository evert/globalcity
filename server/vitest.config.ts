// Server tests: end to end against real servers on the real world (see test/support/global-setup.ts). Test files
// share their worker's server, one file after another, each starting with resetServer(); so no isolation between
// files is needed and modules are loaded once per worker.
//   npm test -w server                  every test
//   npm test -w server -- water social  just these files
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'server',
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/support/global-setup.ts'],
    setupFiles: ['test/support/setup.ts'],
    pool: 'forks',
    isolate: false,
    maxWorkers: Number(process.env.TEST_WORKERS) || 4,
    testTimeout: 120_000,
    hookTimeout: 60_000,
    // one test at a time within a file: the tests in a file play on, in order, on the same server
    sequence: { concurrent: false },
  },
});
