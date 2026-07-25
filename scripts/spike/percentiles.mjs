// Nearest-rank percentile. Shared by every spike benchmark so the REPORT's numbers
// are computed one way.
export function pct(samples, p) {
  if (!samples.length) throw new Error("pct() needs at least one sample");
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

export function summarize(label, samples) {
  return `${label}: n=${samples.length} p50=${pct(samples, 50).toFixed(1)}ms p95=${pct(samples, 95).toFixed(1)}ms`;
}
