// The devReset and devConfig hooks the other tests stand on: after a reset the server is as good as freshly booted
// on an empty save (no players, claims, buildings or save files; the clock and the settings start over; built
// chunks are back to the generated landscape), and devConfig changes settings until the next reset.
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import { CHUNK, START_YEAR, STARTING_FUNDS, CITY_FREEZE_MS, MONUMENT_MIN_POP, type ServerMsg } from '@globalcity/shared';
import { TestClient, resetServer, configure, settle, server, httpUrl, waitFor, sleep } from './support/client.ts';

const health = async (): Promise<{ online: number; players: number; claims: number; tick: number }> => (await fetch(`${httpUrl()}/health`)).json();

describe('devReset', () => {
  let a: TestClient;
  let site: { cx: number; cy: number; x: number; y: number };
  let pristine: Uint32Array;
  beforeAll(async () => {
    await resetServer();
    a = await TestClient.connect('Before');
  });

  it('starts from a fresh server', async () => {
    const h = await health();
    expect(h.players).toBe(1);
    expect(h.claims).toBe(0);
  });

  it('lets a mayor build, and the server saves it', { timeout: 30_000 }, async () => {
    site = await settle(a, [[144, 30]], 18, 12, { claim: false });
    pristine = a.chunk(site.cx, site.cy).slice();
    await a.claim(site.cx, site.cy);
    a.sendRaw({ t: 'devFunds', amount: 100_000 });
    a.sendRaw({ t: 'devPeak', pop: 260_000 });
    await waitFor(() => a.stats?.unlocked.includes('university'), 'university unlocked');
    expect((await a.build('coal', site.x + 1, site.y + 1)).ok).toBe(true);
    expect((await a.build('university', site.x + 6, site.y + 1)).ok).toBe(true);
    for (let x = site.x; x < site.x + 18; x++) await a.build('road', x, site.y + 8);
    expect(a.chunk(site.cx, site.cy)).not.toEqual(pristine);
    // the save is flushed every 10 s
    const save = server().dataDir;
    await waitFor(() => fs.existsSync(path.join(save, 'state.json')) && fs.readdirSync(path.join(save, 'chunks')).length > 0, 'a save', 15_000);
  });

  it('puts everything back as it was at boot', async () => {
    const cfg = await configure({ cityFreezeMs: 1234, monumentMinPop: 1, seasonMonth: 12 });
    expect(cfg).toMatchObject({ cityFreezeMs: 1234, monumentMinPop: 1, seasonMonth: 12 });
    const ticksBefore = (await health()).tick;
    expect(ticksBefore).toBeGreaterThan(0);
    await resetServer();
    expect(a.closeCode, "the old mayor's socket is closed").not.toBeNull();

    const h = await health();
    expect(h).toMatchObject({ online: 0, players: 0, claims: 0 });
    expect(h.tick).toBeLessThan(ticksBefore);

    const save = server().dataDir;
    expect(fs.existsSync(path.join(save, 'state.json'))).toBe(false);
    expect(fs.existsSync(path.join(save, 'buildings.json'))).toBe(false);
    expect(fs.readdirSync(path.join(save, 'chunks'))).toEqual([]);
    expect(fs.existsSync(path.join(save, 'admin-token')), 'the admin token stays').toBe(true);

    const b = await TestClient.connect('After');
    const w = b.welcome as Extract<ServerMsg, { t: 'welcome' }>;
    expect(w.claims).toEqual([]);
    expect(w.time).toEqual({ year: START_YEAR, month: 0, step: 0 });
    expect(w.stats.funds).toBe(STARTING_FUNDS);
    await waitFor(() => b.buildings, 'buildings list');
    expect(b.buildings).toEqual([]);
    expect(b.disasters).toBeNull();
    await b.subscribe([[site.cx, site.cy]]);
    expect(b.chunk(site.cx, site.cy)).toEqual(pristine);
    expect(b.chunk(site.cx, site.cy).length).toBe(CHUNK * CHUNK);
    // the settings are the defaults again
    expect(await configure({})).toMatchObject({ cityFreezeMs: CITY_FREEZE_MS, monumentMinPop: MONUMENT_MIN_POP, seasonMonth: null });
    // and the plot can be founded again
    await b.claim(site.cx, site.cy);
    await sleep(100);
    expect((await health()).claims).toBe(1);
  });

  it('refuses bad settings and changes nothing', async () => {
    await expect(configure({ cityFreezeMs: -1 })).rejects.toThrow(/positive/);
    await expect(configure({ seasonMonth: 13 })).rejects.toThrow(/1\.\.12/);
    await expect(configure({ nonsense: 1 } as never)).rejects.toThrow(/unknown setting/);
    expect(await configure({})).toMatchObject({ cityFreezeMs: CITY_FREEZE_MS, seasonMonth: null });
  });
});
