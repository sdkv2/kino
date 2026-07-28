export type ProfileRow = { key: string; ms: number; n: number };

/** Accumulate wall-time buckets for electron capture profiling. */
export class CaptureProfiler {
  private rows = new Map<string, { ms: number; n: number }>();

  add(key: string, ms: number): void {
    const row = this.rows.get(key) ?? { ms: 0, n: 0 };
    row.ms += ms;
    row.n++;
    this.rows.set(key, row);
  }

  bump(key: string): void {
    this.add(key, 0);
  }

  drain(prefix = "cap:"): ProfileRow[] {
    return [...this.rows.entries()]
      .filter(([, v]) => v.n > 0)
      .map(([key, v]) => ({ key: `${prefix}${key}`, ms: v.ms, n: v.n }))
      .sort((a, b) => b.ms - a.ms);
  }

  reset(): void {
    this.rows.clear();
  }
}
