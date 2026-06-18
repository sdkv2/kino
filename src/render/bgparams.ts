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

// Easing curves. overshoot (back-out) and spring (elastic) intentionally exceed 1 mid-way, so the
// tweened value overshoots its target then settles — punchy.
function applyEase(name: Ease | undefined, p: number): number {
  switch (name) {
    case "easeInOut":
      // Smoothstep: 3p² − 2p³ — the classic S-curve (zero slope at both ends, no overshoot).
      return p * p * (3 - 2 * p);
    case "overshoot": {
      // "Back-out" ease (Penner): pulls past 1 then settles. 1.70158 is the standard back-ease
      // overshoot constant (≈10% overshoot); c3 = c1 + 1 is the cubic coefficient that pairs with it.
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
    }
    case "spring": {
      // Elastic-out ease (Penner): a decaying sine wobble that converges on 1. c4 = 2π/3 is the
      // elastic period; 2^(−10p) is the exponential decay envelope. Endpoints are pinned to avoid NaN.
      if (p === 0 || p === 1) return p;
      const c4 = (2 * Math.PI) / 3;
      return Math.pow(2, -10 * p) * Math.sin((p * 10 - 0.75) * c4) + 1;
    }
    default:
      return p;
  }
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

// One-shot pulse envelope: 1 at the trigger, halving every halfLife seconds, 0 before. Max over triggers.
export function pulseAt(triggers: Trigger[], t: number, halfLife = 0.5): number {
  let v = 0;
  for (const tr of triggers) {
    if (tr.action !== "pulse" || tr.at > t) continue;
    v = Math.max(v, Math.pow(0.5, (t - tr.at) / halfLife));
  }
  return v;
}
