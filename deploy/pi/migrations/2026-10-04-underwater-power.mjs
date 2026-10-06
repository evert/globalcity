// One-off migration (run with the server STOPPED): underwater power lines were placed with the wrong
// orientation tile (Micropolis' HPOWER=208 is drawn north-south, VPOWER=209 east-west). Swap 208<->209 in
// every saved chunk, keeping the flag bits. Usage: node 2026-10-04-underwater-power.mjs <save dir>
import fs from 'node:fs';
import path from 'node:path';
const dir = path.join(process.argv[2] ?? 'data/save', 'chunks');
let files = 0, swapped = 0;
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith('.bin')) continue;
  const p = path.join(dir, f), buf = fs.readFileSync(p);
  let n = 0;
  for (let i = 0; i < buf.length; i += 2) {
    const v = buf.readUInt16LE(i), id = v & 0x3ff;
    if (id === 208 || id === 209) { buf.writeUInt16LE((v & ~0x3ff) | (id === 208 ? 209 : 208), i); n++; }
  }
  if (n) { fs.writeFileSync(p + '.tmp', buf); fs.renameSync(p + '.tmp', p); files++; swapped += n; }
}
console.log(`swapped ${swapped} underwater power line tiles in ${files} chunk files`);
