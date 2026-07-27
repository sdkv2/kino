// Page-side per-phase timing. Off unless the render config sets `profile` (KINO_PROFILE=1), in
// which case every wrapped phase accumulates wall time and the engine dumps the totals after the
// render. Exists because per-frame cost is invisible from node — the only thing measurable from
// out there is seek+capture, and "seek" hides raster, decode, upload, composite and post.
//
// Overhead when on is one performance.now() pair per phase per frame; when off, `sync`/`awaited`
// call straight through.
let on = false;
const totals = new Map<string, { ms: number; n: number }>();
const maxes = new Map<string, number>();
const holds = new Map<string, number>();

export function enableProfile(v: boolean): void {
  on = v;
}

export function profileOn(): boolean {
  return on;
}

export function addSample(key: string, ms: number): void {
  if (!on) return;
  const e = totals.get(key) ?? { ms: 0, n: 0 };
  e.ms += ms;
  e.n += 1;
  totals.set(key, e);
}

/** Spike: track max of a metric (emitted as n=1 on snapshot). */
export function noteMax(key: string, v: number): void {
  if (!on) return;
  maxes.set(key, Math.max(maxes.get(key) ?? -Infinity, v));
}

/** Spike: last-write-wins scalar (emitted as n=1 on snapshot). */
export function noteHold(key: string, v: number): void {
  if (!on) return;
  holds.set(key, v);
}

export function sync<T>(key: string, fn: () => T): T {
  if (!on) return fn();
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    addSample(key, performance.now() - t0);
  }
}

export async function awaited<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
  if (!on) return await fn();
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    addSample(key, performance.now() - t0);
  }
}

export function snapshot(): Array<{ key: string; ms: number; n: number }> {
  for (const [key, v] of maxes) totals.set(key, { ms: v, n: 1 });
  for (const [key, v] of holds) totals.set(key, { ms: v, n: 1 });
  return [...totals.entries()].map(([key, v]) => ({ key, ms: v.ms, n: v.n })).sort((a, b) => b.ms - a.ms);
}

export function resetProfile(): void {
  totals.clear();
  maxes.clear();
  holds.clear();
}
