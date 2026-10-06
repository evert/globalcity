// What a plane or ship is carrying. Purely cosmetic and deterministic: derived from the trip's stable key,
// so every player who queries the same ship sees the same cargo.

function hash(str: string, n: number): number {
  let h = 2166136261 ^ n;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return h >>> 0;
}

const SHIPS: { kind: string; unit: string; min: number; max: number; goods: string[] }[] = [
  { kind: 'Container ship', unit: 'containers', min: 800, max: 9000, goods: ['electronics', 'clothing', 'furniture', 'toys', 'machine parts', 'household goods'] },
  { kind: 'Bulk carrier', unit: 'tonnes', min: 20000, max: 90000, goods: ['grain', 'iron ore', 'coal', 'timber', 'fertiliser'] },
  { kind: 'Tanker', unit: 'tonnes', min: 30000, max: 120000, goods: ['crude oil', 'diesel', 'liquefied gas'] },
  { kind: 'Car carrier', unit: 'cars', min: 1500, max: 6000, goods: ['new cars'] },
  { kind: 'Reefer ship', unit: 'tonnes', min: 3000, max: 12000, goods: ['bananas', 'frozen fish', 'fruit'] },
];

const round = (n: number, step: number): number => Math.max(step, Math.round(n / step) * step);

export interface Cargo { kind: string; amount: number; unit: string; goods: string }

/** Ship type and load for a voyage key. */
export function shipCargo(key: string): Cargo {
  const t = SHIPS[hash(key, 1) % SHIPS.length];
  const amount = round(t.min + (hash(key, 2) % 1000) / 1000 * (t.max - t.min), t.unit === 'containers' || t.unit === 'cars' ? 50 : 500);
  return { kind: t.kind, amount, unit: t.unit, goods: t.goods[hash(key, 3) % t.goods.length] };
}

/** Flight number, passengers and freight for a flight key. */
export function flightLoad(key: string): { flight: string; passengers: number; freightT: number; freight: string } {
  const freight = ['mail', 'medicine', 'flowers', 'electronics', 'fresh fish', 'luggage'];
  return {
    flight: `GC ${100 + (hash(key, 4) % 900)}`,
    passengers: 60 + (hash(key, 5) % 300),
    freightT: 1 + (hash(key, 6) % 20),
    freight: freight[hash(key, 7) % freight.length],
  };
}
