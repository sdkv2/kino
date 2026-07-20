// Frame-driven primitives for the native render page. Clean-room implementations designed from
// kino's own consumer code + publicly documented observable behavior (frame-indexed sequencing,
// damped-spring easing, piecewise-linear interpolation). No Remotion source was referenced.
//
// Everything is a pure function of the current frame, provided via React context and advanced
// by window.kinoSeek (see index.tsx) — no wall clock anywhere.
import React from "react";

export interface VideoConfig {
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
}

const FrameCtx = React.createContext(0);
const ConfigCtx = React.createContext<VideoConfig>({ fps: 30, width: 1080, height: 1920, durationInFrames: 1 });

export const FrameProvider: React.FC<{ frame: number; config: VideoConfig; children: React.ReactNode }> = ({ frame, config, children }) => (
  <ConfigCtx.Provider value={config}>
    <FrameCtx.Provider value={frame}>{children}</FrameCtx.Provider>
  </ConfigCtx.Provider>
);

export const useCurrentFrame = (): number => React.useContext(FrameCtx);
export const useVideoConfig = (): VideoConfig => React.useContext(ConfigCtx);

// Full-bleed layer: absolute inset-0 flex column (the layout contract every kino layer builds on).
export const AbsoluteFill: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ style, children, ...rest }) => (
  <div
    style={{
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: "100%",
      height: "100%",
      display: "flex",
      flexDirection: "column",
      ...style,
    }}
    {...rest}
  >
    {children}
  </div>
);

// Time-window wrapper: children exist only for frame ∈ [from, from+durationInFrames) and see a
// local clock starting at 0. Wraps children in an AbsoluteFill (the layout the composition expects).
export const Sequence: React.FC<{
  from?: number;
  durationInFrames?: number;
  layout?: "absolute-fill" | "none";
  children: React.ReactNode;
}> = ({ from = 0, durationInFrames = Infinity, layout = "absolute-fill", children }) => {
  const frame = useCurrentFrame();
  if (frame < from || frame >= from + durationInFrames) return null;
  const inner = <FrameCtx.Provider value={frame - from}>{children}</FrameCtx.Provider>;
  return layout === "none" ? inner : <AbsoluteFill>{inner}</AbsoluteFill>;
};

// Clock override: children see a fixed frame while active (freeze-frame holds).
export const Freeze: React.FC<{ frame: number; active?: boolean; children: React.ReactNode }> = ({ frame, active = true, children }) =>
  active ? <FrameCtx.Provider value={frame}>{children}</FrameCtx.Provider> : <>{children}</>;

export const Img: React.FC<React.ImgHTMLAttributes<HTMLImageElement>> = (props) => <img {...props} />;

// Map a publicDir-relative asset path to the local render server URL.
export function staticFile(p: string): string {
  return "/public/" + p.split("/").map(encodeURIComponent).join("/");
}

// --- interpolate ---------------------------------------------------------------------------------

type Extrapolate = "extend" | "clamp" | "identity";
export interface InterpolateOptions {
  easing?: (t: number) => number;
  extrapolateLeft?: Extrapolate;
  extrapolateRight?: Extrapolate;
}

// Piecewise-linear map of `input` through inputRange→outputRange, optional easing per segment and
// clamped/extended extrapolation. Standard animation-math; mirrors the call sites in components.tsx.
export function interpolate(input: number, inputRange: number[], outputRange: number[], options: InterpolateOptions = {}): number {
  const { easing, extrapolateLeft = "extend", extrapolateRight = "extend" } = options;
  const n = inputRange.length;
  if (input < inputRange[0]) {
    if (extrapolateLeft === "clamp") return outputRange[0];
    if (extrapolateLeft === "identity") return input;
  }
  if (input > inputRange[n - 1]) {
    if (extrapolateRight === "clamp") return outputRange[n - 1];
    if (extrapolateRight === "identity") return input;
  }
  // find segment (input beyond the ends extends the first/last segment)
  let i = 0;
  while (i < n - 2 && input >= inputRange[i + 1]) i++;
  const a = inputRange[i];
  const b = inputRange[i + 1];
  const span = b - a;
  let t = span === 0 ? 0 : (input - a) / span;
  if (easing) t = easing(Math.min(1, Math.max(0, t)));
  return outputRange[i] + (outputRange[i + 1] - outputRange[i]) * t;
}

// --- easing --------------------------------------------------------------------------------------

type EasingFn = (t: number) => number;
export const Easing = {
  cubic: ((t: number) => t * t * t) as EasingFn,
  in: (fn: EasingFn): EasingFn => fn,
  out: (fn: EasingFn): EasingFn => (t) => 1 - fn(1 - t),
  inOut:
    (fn: EasingFn): EasingFn =>
    (t) =>
      t < 0.5 ? fn(2 * t) / 2 : 1 - fn(2 * (1 - t)) / 2,
};

// --- spring --------------------------------------------------------------------------------------

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
