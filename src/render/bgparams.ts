// Pure keyframe tweening + trigger envelope for agent-driven backgrounds. Frame-deterministic.
export type ParamValue = number | string;
export type Ease = "linear" | "easeInOut" | "overshoot" | "spring";
export interface Keyframe {
  at: number;
  params: Record<string, ParamValue>;
  ease?: Ease;
}
export interface Trigger {
  at: number;
  action: string;
}

/** Map linear 0→1 through a named curve. overshoot/spring may briefly leave [0,1]. */
export function applyEase(name: Ease | "out" | undefined, p: number): number {
  const x = Math.min(1, Math.max(0, p));
  switch (name) {
    case "out":
      // Ease-out cubic — entrances that land soft without scrubbed @keyframes.
      return 1 - Math.pow(1 - x, 3);
    case "easeInOut":
      // Smoothstep: 3p² − 2p³ — the classic S-curve (zero slope at both ends, no overshoot).
      return x * x * (3 - 2 * x);
    case "overshoot": {
      // "Back-out" ease (Penner): pulls past 1 then settles. 1.70158 is the standard back-ease
      // overshoot constant (≈10% overshoot); c3 = c1 + 1 is the cubic coefficient that pairs with it.
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
    }
    case "spring": {
      // Elastic-out ease (Penner): a decaying sine wobble that converges on 1. c4 = 2π/3 is the
      // elastic period; 2^(−10p) is the exponential decay envelope. Endpoints are pinned so they're
      // exactly 0 and 1 (the raw formula lands at ~1.0005 at p=1, not precisely 1).
      if (x === 0 || x === 1) return x;
      const c4 = (2 * Math.PI) / 3;
      return Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * c4) + 1;
    }
    default:
      return x;
  }
}

/** Precomputed progress curves for motion graphics (CSS vars + env.*). */
export function progressCurves(progress: number): {
  out: number;
  inout: number;
  overshoot: number;
  spring: number;
  edge: number;
} {
  return {
    out: applyEase("out", progress),
    inout: applyEase("easeInOut", progress),
    overshoot: applyEase("overshoot", progress),
    spring: applyEase("spring", progress),
    // 0 at beat start/end, 1 at mid — seam-safe life / breath without hand-rolled sin().
    edge: Math.sin(Math.min(1, Math.max(0, progress)) * Math.PI),
  };
}

function rgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");

function lerpValue(a: ParamValue, b: ParamValue, p: number): ParamValue {
  if (typeof a === "number" && typeof b === "number") return a + (b - a) * p;
  if (typeof a === "string" && typeof b === "string") {
    const ca = rgb(a);
    const cb = rgb(b);
    if (ca && cb) return `#${hex2(ca[0] + (cb[0] - ca[0]) * p)}${hex2(ca[1] + (cb[1] - ca[1]) * p)}${hex2(ca[2] + (cb[2] - ca[2]) * p)}`;
  }
  return p < 1 ? a : b; // non-tweenable → snap to the later keyframe
}

// Resolve every param at time t: base values overridden by per-param keyframe tracks (clamped at ends).
export function paramsAt(base: Record<string, ParamValue>, keyframes: Keyframe[], t: number): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = { ...base };
  const keys = new Set<string>();
  for (const k of keyframes) for (const p of Object.keys(k.params)) keys.add(p);
  for (const key of keys) {
    const track = keyframes.filter((k) => key in k.params).sort((a, b) => a.at - b.at);
    if (!track.length) continue;
    if (t <= track[0].at) {
      out[key] = track[0].params[key];
      continue;
    }
    if (t >= track[track.length - 1].at) {
      out[key] = track[track.length - 1].params[key];
      continue;
    }
    let i = 0;
    while (i < track.length - 1 && track[i + 1].at <= t) i++;
    const a = track[i];
    const b = track[i + 1];
    const raw = (t - a.at) / (b.at - a.at);
    out[key] = lerpValue(a.params[key], b.params[key], applyEase(b.ease, raw));
  }
  return out;
}

export type PulseOpts = {
  /** Seconds to reach peak after trigger (default 0.045). */
  attack?: number;
  /** Exponential decay time-constant after peak (default 0.28). */
  decay?: number;
};

/**
 * One-shot pulse envelope: fast attack to 1, then exponential decay. Max over overlapping triggers.
 * Older API took `halfLife` as the 3rd arg (time to fall to 0.5); still accepted for callers/tests.
 */
export function pulseAt(triggers: Trigger[], t: number, halfLifeOrOpts: number | PulseOpts = 0.28): number {
  const opts: PulseOpts =
    typeof halfLifeOrOpts === "number"
      ? // half-life → decay τ where e^(-hl/τ)=0.5 → τ = hl / ln(2)
        { decay: halfLifeOrOpts / Math.LN2 }
      : halfLifeOrOpts;
  const attack = opts.attack ?? 0.045;
  const decay = opts.decay ?? 0.28;
  let v = 0;
  for (const tr of triggers) {
    if (tr.action !== "pulse" || tr.at > t) continue;
    const age = t - tr.at;
    const rise = attack <= 0 ? 1 : Math.min(1, age / attack);
    const fall = Math.exp(-Math.max(0, age - attack) / decay);
    v = Math.max(v, rise * fall);
  }
  return v;
}
