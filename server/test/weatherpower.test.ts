// Wind and solar follow the weather (weatherpower.ts, set here with devWeather): a wind farm makes nothing in a
// calm and its most in a gale; a solar farm (unlocked at 120,000 people, a 4x4 custom building) makes most with the
// sun high in a clear sky, a quarter of that under overcast, and nothing at night. Coal doesn't care. Snow on the
// roads is in the city's stats (it makes the traffic heavier).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SOLAR_PEAK, WIND_PEAK, COAL_POWER, solarShare, windShare } from '@globalcity/shared';
import { TestClient, resetServer, settle, sleep, TICK } from './support/client.ts';
import { at } from './support/fixture.ts';

const ticks = (n: number): Promise<void> => sleep(n * TICK);

describe('power from the weather', () => {
  let c: TestClient;
  let X: number, Y: number;
  /** Set the weather everywhere and wait for the next power settle. */
  async function weather(w: Record<string, number | boolean>): Promise<number> {
    c.sendRaw({ t: 'devWeather', ...w });
    await ticks(3);
    return c.stats!.powerSupply;
  }

  beforeAll(async () => {
    await resetServer();
    c = await TestClient.connect('Mayor-Sun', { v: 'test' });
    const s = await settle(c, [at('inland'), at('east')], 20, 10, { x0: 2, x1: 41, y0: 2, y1: 51 });
    X = s.x;
    Y = s.y;
    c.sendRaw({ t: 'devFunds', amount: 200000 });
    c.sendRaw({ t: 'devPeak', pop: 160000 }); // wind farm 150,000, solar farm 120,000
    await ticks(2);
    await c.build('residential', X + 15, Y + 2); // a zone, so the city is simulated
  });
  afterAll(() => c.sendRaw({ t: 'devWeather' }));

  it('unlocks the solar farm at 120,000 people', () => {
    expect(c.stats!.unlocked).toContain('solar');
  });

  it('a wind farm follows the wind', async () => {
    const r = await c.build('windfarm', X + 1, Y + 1);
    expect(r.toasts.filter((t) => t.kind === 'error')).toEqual([]);
    expect(await weather({ wind: 0 }), 'a calm').toBe(0);
    expect(await weather({ wind: 6 })).toBe(Math.round(WIND_PEAK * windShare(6, false)));
    expect(await weather({ wind: 12 }), 'a gale').toBe(Math.round(WIND_PEAK * 0.6));
    expect(await weather({ wind: 25 }), 'a storm: shut down').toBe(0);
  });

  it('a solar farm follows the sun and the clouds', async () => {
    const r = await c.build('solar', X + 6, Y + 1);
    expect(r.toasts.filter((t) => t.kind === 'error')).toEqual([]);
    expect(c.kind(X + 7, Y + 2), 'the custom building stands').toBeGreaterThan(0);
    const wind = { wind: 0 }; // the wind farm makes nothing, so the supply is the sun's alone
    expect(await weather({ ...wind, sun: 60, cloud: 0 }), 'noon-ish, clear').toBe(Math.round(SOLAR_PEAK * solarShare(60, 0)));
    expect(await weather({ ...wind, sun: 60, cloud: 1 }), 'overcast').toBe(Math.round(SOLAR_PEAK * solarShare(60, 1)));
    expect(await weather({ ...wind, sun: -5, cloud: 0 }), 'night').toBe(0);
    expect(c.stats!.built.solar, 'counted as built').toBe(1);
  });

  it('snow on the roads: lying snow counts fully from 10 cm, falling snow at least half', async () => {
    await weather({ snowDepth: 0.3 });
    expect(c.stats!.snowyRoads).toBe(1);
    await weather({ snowDepth: 0, snowing: true });
    expect(c.stats!.snowyRoads).toBe(0.5);
    await weather({ snowDepth: 0, snowing: false });
    expect(c.stats!.snowyRoads).toBe(0);
  });

  it('coal makes the same whatever the weather', async () => {
    await c.build('bulldozer', X + 7, Y + 2); // the solar farm goes; coal in its place
    await c.build('coal', X + 6, Y + 1);
    expect(await weather({ wind: 0, sun: -5, cloud: 1 })).toBe(COAL_POWER);
    expect(await weather({ wind: 0, sun: 80, cloud: 0 })).toBe(COAL_POWER);
  });
});
