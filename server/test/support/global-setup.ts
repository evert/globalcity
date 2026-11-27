// Boots one game server per Vitest worker, each on its own port with its own empty save, on the real generated
// world (several tests look for land and water at real places: npm run gen:world). Loading the world takes a few
// seconds, so it happens once per worker; every test file then starts with resetServer() (the devReset hook).
//
//   TEST_PORT     first port (default 8791); worker i plays on TEST_PORT + i - 1
//   TEST_WORKERS  number of workers and servers (default in vitest.config.ts)
//
// Server logs and saves go to $TMPDIR/globalcity-tests.XXXXXX (printed at the end).
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TestProject } from 'vitest/node';

const TICK_MS = 500;
/** Settings the tests set themselves (devConfig): never inherited from the shell running the tests. */
const CONFIG_ENV = [
  'SEASON_MONTH',
  'ABANDON_DAY_MS',
  'CITY_FREEZE_MS',
  'SMALL_CITY_RELEASE_MS',
  'REGROW_MS',
  'REGROW_P',
  'MONUMENT_MIN_POP',
  'DISASTER_EVERY_MS',
  'ALL_ONLINE',
  'DISASTER_TRIGGER',
  'NOTIFY_DB',
  'HOST',
];
const serverDir = path.resolve(import.meta.dirname, '../..');

async function up(port: number): Promise<boolean> {
  try {
    return (await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) })).ok;
  } catch {
    return false;
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const n = project.config.maxWorkers;
  const base = Number(process.env.TEST_PORT) || 8791;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'globalcity-tests.'));
  const ports = Array.from({ length: n }, (_, i) => base + i);
  for (const port of ports) if (await up(port)) throw new Error(`Something is already listening on port ${port}; set TEST_PORT to a free range.`);

  const env: NodeJS.ProcessEnv = { ...process.env, DEV_HOOKS: '1', TICK_MS: String(TICK_MS), STEPS_PER_MONTH: '1', HOST: '127.0.0.1' };
  for (const k of CONFIG_ENV) if (k !== 'HOST') delete env[k];
  const procs: ChildProcess[] = [];
  const servers = ports.map((port, i) => {
    // each server in a directory of its own: the notification database lives beside the save directory
    const dir = path.join(work, `server-${i + 1}`);
    const dataDir = path.join(dir, 'save');
    fs.mkdirSync(dataDir, { recursive: true });
    const log = path.join(dir, 'server.log');
    const out = fs.openSync(log, 'w');
    const p = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: serverDir,
      env: { ...env, PORT: String(port), DATA_DIR: dataDir },
      stdio: ['ignore', out, out],
    });
    fs.closeSync(out);
    procs.push(p);
    return { port, log, dataDir };
  });

  const stop = async (): Promise<void> => {
    await Promise.all(
      procs.map(
        (p) =>
          new Promise<void>((res) => {
            if (p.exitCode !== null || p.signalCode !== null) return res();
            const kill = setTimeout(() => p.kill('SIGKILL'), 5000);
            p.once('exit', () => {
              clearTimeout(kill);
              res();
            });
            p.kill('SIGTERM');
          }),
      ),
    );
  };

  try {
    await Promise.all(
      servers.map(async (s, i) => {
        const t0 = Date.now();
        while (!(await up(s.port))) {
          const p = procs[i];
          if (p.exitCode !== null || Date.now() - t0 > 120_000) {
            const tail = fs.readFileSync(s.log, 'utf8').split('\n').slice(-20).join('\n');
            throw new Error(`test server on port ${s.port} did not start:\n${tail}`);
          }
          await new Promise((r) => setTimeout(r, 100));
        }
      }),
    );
  } catch (e) {
    await stop();
    throw e;
  }

  project.provide('servers', servers);
  project.provide('tickMs', TICK_MS);
  return async () => {
    await stop();
    console.log(`Test server logs and saves: ${work}`);
  };
}
