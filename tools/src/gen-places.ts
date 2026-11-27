import './world-size.js';
import { mkdirSync, existsSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lonLatToTile, WORLD_TAG, WORLD_W } from '@globalcity/shared';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RAW = resolve(ROOT, 'data/raw');
const OUT = resolve(ROOT, `data/world-${WORLD_TAG}`);
const BASE = 'https://raw.githubusercontent.com/martynafford/natural-earth-geojson/master';

const pick = (p: Record<string, unknown>, ...keys: string[]): unknown => {
  for (const k of keys) if (p[k] !== undefined && p[k] !== null && p[k] !== '') return p[k];
  return undefined;
};

export async function genPlaces(): Promise<void> {
  mkdirSync(RAW, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  let json: any = null,
    url = '';
  for (const res of ['10m', '50m']) {
    const file = resolve(RAW, `ne_${res}_populated_places.json`);
    url = `${BASE}/${res}/cultural/ne_${res}_populated_places.json`;
    try {
      if (!existsSync(file)) {
        console.log(`downloading ${url}`);
        const r = await fetch(url);
        if (!r.ok) {
          console.log(`  HTTP ${r.status}`);
          continue;
        }
        const text = await r.text();
        JSON.parse(text);
        writeFileSync(file, text);
      }
      json = JSON.parse(readFileSync(file, 'utf8'));
      console.log(`places: using ${res} (${(statSync(file).size / 1e6).toFixed(1)} MB)`);
      break;
    } catch (e) {
      console.log(`  failed ${res}: ${(e as Error).message}`);
    }
  }
  if (!json) throw new Error('could not get populated places');

  const places: [string, number, number, number, string][] = [];
  for (const f of json.features) {
    const p = f.properties ?? {};
    const name = String(pick(p, 'NAME', 'name', 'NAMEASCII', 'nameascii') ?? '').trim();
    if (!name) continue;
    const c = f.geometry?.type === 'Point' ? f.geometry.coordinates : null;
    if (!c) continue;
    const { x, y } = lonLatToTile(c[0], c[1]);
    const pop = Number(pick(p, 'POP_MAX', 'pop_max') ?? 0) || 0;
    const country = String(pick(p, 'ADM0NAME', 'adm0name', 'SOV0NAME', 'sov0name') ?? '');
    places.push([name, x, y, pop, country]);
  }
  places.sort((a, b) => b[3] - a[3]);

  const outFile = resolve(OUT, 'places.json');
  writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), source: url, places }));
  console.log('--- places summary ---');
  console.log(`count: ${places.length}, size: ${(statSync(outFile).size / 1024).toFixed(0)} KB`);
  for (const p of places.slice(0, 5)) console.log(`  ${p[0]} (${p[4]}) pop=${p[3]} tile=(${p[1]},${p[2]})`);
  const check = (n: string, tx: number, ty: number) => {
    const p = places.find((q) => q[0] === n);
    const ok = !!p && Math.abs(p[1] - tx) <= 10 && Math.abs(p[2] - ty) <= 10;
    console.log(`  sanity ${n}: ${p ? `(${p[1]},${p[2]})` : 'missing'} expected ~(${tx},${ty}) ${ok ? 'OK' : 'FAIL'}`);
  };
  check('London', Math.round((4093 * WORLD_W) / 8192), Math.round((876 * WORLD_W) / 8192));
  check('Sydney', Math.round((7534 * WORLD_W) / 8192), Math.round((2819 * WORLD_W) / 8192));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  genPlaces().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
