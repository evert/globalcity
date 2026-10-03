// Small shared helpers for the server: logging with timestamps and timing, RNG.

export function log(...args: unknown[]): void {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}]`, ...args);
}

export function warn(...args: unknown[]): void {
  const ts = new Date().toISOString().slice(11, 23);
  console.warn(`[${ts}] WARN`, ...args);
}

/** Run fn, log how long it took, return its result. */
export function timed<T>(label: string, fn: () => T): T {
  const t0 = performance.now();
  const r = fn();
  log(`${label}: ${(performance.now() - t0).toFixed(0)} ms`);
  return r;
}

/** Uniform integer in [0, n] inclusive (Micropolis getRandom semantics). */
export const randInt = (n: number): number => Math.floor(Math.random() * (n + 1));

export const chance = (p: number): boolean => Math.random() < p;
