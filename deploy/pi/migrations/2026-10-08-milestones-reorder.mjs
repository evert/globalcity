// One-off migration (run with the server STOPPED) for the 2026-10-08 milestone reshuffle: fire and police
// stations unlock later (15,000 / 30,000) and the ladder was reordered (school, city hall, seaport, wind farm,
// university, stadium, offshore wind, airport). Unlocks are permanent, so every player keeps what the
// PREVIOUS thresholds had unlocked: added to `grandfathered` (and `announced`, so no toast repeats).
// Usage: node 2026-10-08-milestones-reorder.mjs <save dir> [--dry-run]
import fs from 'node:fs';
import path from 'node:path';

const PREVIOUS = { fire: 5000, police: 10000, cityhall: 20000, airport: 35000, school: 50000, seaport: 100000, university: 150000, stadium: 250000, windfarm: 500000, offshore: 1000000 };
const dir = process.argv[2] ?? 'data/save';
const dry = process.argv.includes('--dry-run');
const file = path.join(dir, 'state.json');
const state = JSON.parse(fs.readFileSync(file, 'utf8'));

let players = 0, kept = 0;
const byBuilding = {};
for (const p of state.players) {
  const had = Object.keys(PREVIOUS).filter((b) => (p.peakPop ?? 0) >= PREVIOUS[b]);
  if (!had.length) continue;
  const g = new Set(p.grandfathered ?? []), a = new Set(p.announced ?? []);
  let added = 0;
  for (const b of had) {
    if (!g.has(b)) { g.add(b); added++; byBuilding[b] = (byBuilding[b] ?? 0) + 1; }
    a.add(b);
  }
  p.grandfathered = [...g];
  p.announced = [...a];
  players++; kept += added;
}
console.log(`${dry ? '[dry run] ' : ''}${players} players with unlocks; ${kept} unlocks newly grandfathered`);
console.log('by building:', JSON.stringify(byBuilding));
if (!dry) {
  fs.copyFileSync(file, file + '.before-milestones-reorder');
  fs.writeFileSync(file + '.tmp', JSON.stringify(state));
  fs.renameSync(file + '.tmp', file);
  console.log(`wrote ${file} (backup: state.json.before-milestones-reorder)`);
}
