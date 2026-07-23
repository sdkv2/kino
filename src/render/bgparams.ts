// Pure keyframe tweening + trigger envelope for agent-driven backgrounds. Frame-deterministic.
export type ParamValue = number | string;

/** All keyframe `ease` values — single source for schema + applyEase. */
export const EASE_NAMES = [
  "linear",
  "easeIn",
  "easeOut",
  "easeInOut",
  "easeInQuad",
  "easeOutQuad",
  "easeInOutQuad",
  "easeInCubic",
  "easeOutCubic",
  "easeInOutCubic",
  "easeInQuart",
  "easeOutQuart",
  "easeInOutQuart",
  "easeInExpo",
  "easeOutExpo",
  "easeInOutExpo",
  "overshoot",
  "spring",
] as const;
export type Ease = (typeof EASE_NAMES)[number];

export interface Keyframe {
  at: number;
  params: Record<string, ParamValue>;
  ease?: Ease;
}
export interface Trigger {
  at: number;
  action: string;
}

function clamp01(p: number): number {
  return Math.min(1, Math.max(0, p));
}
function easeInPow(x: number, n: number): number {
  return Math.pow(x, n);
}
function easeOutPow(x: number, n: number): number {
  return 1 - Math.pow(1 - x, n);
}
function easeInOutPow(x: number, n: number): number {
  return x < 0.5 ? Math.pow(2 * x, n) / 2 : 1 - Math.pow(2 * (1 - x), n) / 2;
}
function easeInExpo(x: number): number {
  return x === 0 ? 0 : Math.pow(2, 10 * x - 10);
}
function easeOutExpo(x: number): number {
  return x === 1 ? 1 : 1 - Math.pow(2, -10 * x);
}
function easeInOutExpo(x: number): number {
  if (x === 0 || x === 1) return x;
  return x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2;
}

/** Map linear 0→1 through a named curve. overshoot/spring may briefly leave [0,1]. */
export function applyEase(name: Ease | "out" | undefined, p: number): number {
  const x = clamp01(p);
  switch (name) {
    case "easeIn":
    case "easeInCubic":
      return easeInPow(x, 3);
    case "easeOut":
    case "easeOutCubic":
    case "out":
      return easeOutPow(x, 3);
    case "easeInOutCubic":
      return easeInOutPow(x, 3);
    case "easeInOut":
      // Smoothstep: 3p² − 2p³ — zero slope at both ends, no overshoot.
      return x * x * (3 - 2 * x);
    case "easeInQuad":
      return easeInPow(x, 2);
    case "easeOutQuad":
      return easeOutPow(x, 2);
    case "easeInOutQuad":
      return easeInOutPow(x, 2);
    case "easeInQuart":
      return easeInPow(x, 4);
    case "easeOutQuart":
      return easeOutPow(x, 4);
    case "easeInOutQuart":
      return easeInOutPow(x, 4);
    case "easeInExpo":
      return easeInExpo(x);
    case "easeOutExpo":
      return easeOutExpo(x);
    case "easeInOutExpo":
      return easeInOutExpo(x);
    case "overshoot": {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
    }
    case "spring": {
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
  in: number;
  out: number;
  inout: number;
  overshoot: number;
  spring: number;
  edge: number;
} {
  return {
    in: applyEase("easeIn", progress),
    out: applyEase("easeOut", progress),
    inout: applyEase("easeInOut", progress),
    overshoot: applyEase("overshoot", progress),
    spring: applyEase("spring", progress),
    edge: Math.sin(clamp01(progress) * Math.PI),
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
  return p < 1 ? a : b;
}

export function paramsAt(
  base: Record<string, ParamValue>,
  keyframes: Keyframe[],
  t: number,
  opts?: { implicitBase?: boolean },
): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = { ...base };
  const keys = new Set<string>();
  for (const k of keyframes) for (const p of Object.keys(k.params)) keys.add(p);
  for (const key of keys) {
    const track = keyframes.filter((k) => key in k.params).sort((a, b) => a.at - b.at);
    if (!track.length) continue;
    if (opts?.implicitBase && track[0].at > 0 && key in base) track.unshift({ at: 0, params: { [key]: base[key] } });
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
  attack?: number;
  decay?: number;
};

export function pulseAt(triggers: Trigger[], t: number, halfLifeOrOpts: number | PulseOpts = 0.28): number {
  const opts: PulseOpts =
    typeof halfLifeOrOpts === "number" ? { decay: halfLifeOrOpts / Math.LN2 } : halfLifeOrOpts;
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
