// Admin rename (run with the server STOPPED): set one player's mayor and city name and lock them, so the
// player can no longer change either (PlayerRecord.namesLocked, enforced by the server's rename handlers).
// Usage: node 2026-10-05-admin-rename.mjs <save dir> --id <id prefix> --city <new city> --mayor <new mayor> [--dry-run]
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const dir = args[0];
const opt = (k) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const id = opt('--id'),
  city = opt('--city'),
  mayor = opt('--mayor'),
  dry = args.includes('--dry-run');
if (!dir || !id || !city || !mayor) {
  console.error('usage: <save dir> --id <prefix> --city <name> --mayor <name> [--dry-run]');
  process.exit(2);
}
const file = path.join(dir, 'state.json');
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
const matches = state.players.filter((p) => p.id.startsWith(id));
if (matches.length !== 1) {
  console.error(`expected exactly one player with id ${id}*, found ${matches.length}`);
  process.exit(1);
}
const p = matches[0];
const clash = state.players.find((q) => q !== p && (q.cityName ?? '').toLowerCase() === city.toLowerCase());
if (clash) {
  console.error(`another city is already called ${city} (player ${clash.id.slice(0, 8)})`);
  process.exit(1);
}
console.log(
  `${dry ? '[dry run] ' : ''}${p.id.slice(0, 8)}: mayor ${JSON.stringify(p.name)} -> ${JSON.stringify(mayor)}, city ${JSON.stringify(p.cityName)} -> ${JSON.stringify(city)}, names locked`,
);
if (dry) process.exit(0);
p.name = mayor;
p.cityName = city;
p.namesLocked = true;
fs.copyFileSync(file, file + '.before-admin-rename');
fs.writeFileSync(file + '.tmp', JSON.stringify(state));
fs.renameSync(file + '.tmp', file);
console.log(`wrote ${file} (backup: state.json.before-admin-rename)`);
