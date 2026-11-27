// One-off migration (run with the server STOPPED) for the 2026-10-05 milestone change: every population
// threshold was multiplied by ten, and the wind farm and airport swapped places. Unlocks are meant to be
// permanent, so every player keeps what the OLD thresholds had already unlocked: those buildings are added
// to the player's `grandfathered` list (and to `announced`, so no milestone toast repeats).
// Usage: node 2026-10-05-milestones-10x.mjs <save dir> [--dry-run]
import fs from 'node:fs';
import path from 'node:path';

const OLD = {
  fire: 500,
  police: 1000,
  cityhall: 2000,
  windfarm: 3500,
  school: 5000,
  seaport: 10000,
  university: 15000,
  stadium: 25000,
  airport: 50000,
  offshore: 100000,
};
const dir = process.argv[2] ?? 'data/save';
const dry = process.argv.includes('--dry-run');
const file = path.join(dir, 'state.json');
const state = JSON.parse(fs.readFileSync(file, 'utf8'));

let players = 0,
  kept = 0;
const byBuilding = {};
for (const p of state.players) {
  const peak = p.peakPop ?? 0;
  const had = Object.keys(OLD).filter((b) => peak >= OLD[b]);
  if (!had.length) continue;
  const g = new Set(p.grandfathered ?? []),
    a = new Set(p.announced ?? []);
  let added = 0;
  for (const b of had) {
    if (!g.has(b)) {
      g.add(b);
      added++;
      byBuilding[b] = (byBuilding[b] ?? 0) + 1;
    }
    a.add(b);
  }
  p.grandfathered = [...g];
  p.announced = [...a];
  players++;
  kept += added;
}
console.log(`${dry ? '[dry run] ' : ''}${players} players keep ${kept} unlocks they had under the old thresholds`);
console.log('by building:', JSON.stringify(byBuilding));
if (!dry) {
  fs.copyFileSync(file, file + '.before-milestones-10x');
  fs.writeFileSync(file + '.tmp', JSON.stringify(state));
  fs.renameSync(file + '.tmp', file);
  console.log(`wrote ${file} (backup: state.json.before-milestones-10x)`);
}
