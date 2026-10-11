// Admin cash grant (run with the server STOPPED): add funds to one player's city. Lifeline debt is left alone.
// Usage: node admin-grant.mjs <save dir> --id <id prefix> --amount <dollars> [--dry-run]
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const dir = args[0];
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const id = opt('--id'), amount = Number(opt('--amount')), dry = args.includes('--dry-run');
if (!dir || !id || !Number.isInteger(amount) || amount <= 0) { console.error('usage: <save dir> --id <prefix> --amount <dollars> [--dry-run]'); process.exit(2); }
const file = path.join(dir, 'state.json');
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
const matches = state.players.filter((p) => p.id.startsWith(id));
if (matches.length !== 1) { console.error(`expected exactly one player with id ${id}*, found ${matches.length}`); process.exit(1); }
const p = matches[0];
const before = p.funds ?? 0;
console.log(`${dry ? '[dry run] ' : ''}${p.id.slice(0, 8)} ${JSON.stringify(p.name)} of ${JSON.stringify(p.cityName)}: funds $${before} -> $${before + amount}`);
if (dry) process.exit(0);
p.funds = before + amount;
if (p.stats) p.stats.funds = p.funds;
fs.copyFileSync(file, file + '.before-admin-grant');
fs.writeFileSync(file + '.tmp', JSON.stringify(state));
fs.renameSync(file + '.tmp', file);
console.log(`wrote ${file} (backup: state.json.before-admin-grant)`);
