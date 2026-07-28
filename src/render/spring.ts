// Damped-spring easing. Pure frame math, extracted from the render page runtime so node-side
// modules (layers.ts and its tests) can use it without pulling React in.

export interface SpringConfig {
  damping?: number;
  mass?: number;
  stiffness?: number;
  overshootClamping?: boolean;
}

// Closed-form solution of the damped harmonic oscillator m·x″ + c·x′ + k·x = 0 driven from 0 → 1
// with zero initial velocity (textbook physics; also the formulation of the MIT-licensed `wobble`
// spring library this style of animation spring popularised).
function springValue(t: number, { damping = 10, mass = 1, stiffness = 100 }: SpringConfig): number {
  const w0 = Math.sqrt(stiffness / mass); // natural frequency
  // Damping ratio, clamped at critical: the legacy engine treats any over-damped config as
  // critically damped (verified black-box — damping 180 and 200 produce identical curves, and
  // both match the critical-damping closed form exactly). Without the clamp, damping≈200 configs
  // (kicker/logo fades) crawl for seconds instead of settling in ~15 frames.
  const zeta = Math.min(1, damping / (2 * Math.sqrt(stiffness * mass)));
  let x: number;
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    const decay = Math.exp(-zeta * w0 * t);
    x = 1 - decay * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
  } else {
    x = 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  }
  return x;
}

const SETTLE_THRESHOLD = 0.005;
const naturalCache = new Map<string, number>();

// Frames (at `fps`) until the spring stays within 0.005 of its target — the animation's natural
// duration, used to rescale time when a fixed durationInFrames is requested.
function naturalDurationFrames(config: SpringConfig, fps: number): number {
  const key = `${config.damping ?? 10}/${config.mass ?? 1}/${config.stiffness ?? 100}/${fps}`;
  const hit = naturalCache.get(key);
  if (hit !== undefined) return hit;
  const max = fps * 120;
  let last = 0;
  for (let n = 0; n <= max; n++) {
    if (Math.abs(1 - springValue(n / fps, config)) >= SETTLE_THRESHOLD) last = n;
  }
  const dur = Math.min(max, last + 1);
  naturalCache.set(key, dur);
  return dur;
}

export function spring(opts: { frame: number; fps: number; config?: SpringConfig; durationInFrames?: number }): number {
  const { frame, fps, config = {}, durationInFrames } = opts;
  if (frame <= 0) return 0;
  let t = frame / fps;
  if (durationInFrames && durationInFrames > 0) {
    t = (frame * (naturalDurationFrames(config, fps) / durationInFrames)) / fps;
  }
  const x = springValue(t, config);
  return config.overshootClamping ? Math.min(1, x) : x;
}
