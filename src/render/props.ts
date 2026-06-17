// Shared prop types for the Remotion composition. Lives in compiled-land so both the
// CLI (render.ts, build.ts) and the Remotion .tsx (bundled by esbuild) can import it.
export interface Theme {
  font: string;
  fontUrl?: string | null; // staticFile-relative TTF to load (registry font), else system font
  night: string;
  mint: string;
  green: string;
  gold: string;
  white: string;
  brandName?: string; // brand name token; rendered green wherever it appears in word captions
  captionFontSize: number;
  captionStroke: number;
  captionBg?: { bg: string; appOnly: boolean } | null; // translucent plate behind lower-third captions (opt-in)
}

// One spoken word and its absolute on-timeline span (from the VO timestamps).
export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

export interface KinoSegment {
  kind: "avatar" | "app" | "motion";
  asset?: string;
  caption: string;
  startSec: number;
  endSec: number;
  kicker?: { text: string; color: string; fg: string };
  shot?: string; // resolved camera shot (see render/motion)
  transition?: string; // resolved in/out transition for app cut-ins
  captionMode?: "phrase" | "words"; // "words" = spoken text revealed word-by-word, synced to VO
  words?: WordTiming[]; // absolute word timings (present for captionMode "words")
  emphasis?: string[]; // words to emphasise (glow/pop) in "words" mode
  captionKeyframes?: BgKeyframe[]; // tween the caption (x/y offset %, scale, opacity)
  kickerKeyframes?: BgKeyframe[]; // tween the kicker (app segments)
  motion?: MotionGraphicProps; // resolved graphic for kind === "motion"
  motionOverlay?: MotionGraphicProps; // resolved overlay graphic layered on this beat
}

// Where an avatar clip sits on the main timeline + which slice of the (trimmed) clip to play.
export interface AvatarWindow {
  fromSec: number; // main-timeline start
  toSec: number; // main-timeline end
  audioStartSec: number; // offset into the trimmed avatar clip
}

// Faceless background selection + agent animation, resolved at build time.
export type BgParamValue = number | string;
export interface BgKeyframe {
  at: number;
  params: Record<string, BgParamValue>;
  ease?: "linear" | "easeInOut" | "overshoot" | "spring";
}
export interface BgTrigger {
  at: number;
  action: string;
}
export interface BackgroundProps {
  kind: "glow" | "image" | "mesh" | "aurora" | "particles" | "grid" | "custom";
  image: string | null; // staticFile-relative path, for kind="image"
  customCode: string | null; // draw-fn source, for kind="custom"
  params: Record<string, BgParamValue>; // base param values (tweened by keyframes)
  keyframes: BgKeyframe[]; // agent-authored param tweens over time
  triggers: BgTrigger[]; // agent-authored one-shot actions (e.g. pulse)
}

// A resolved motion graphic: the sanitized HTML plus the JSON-owned timing controls.
export interface MotionGraphicProps {
  html: string; // sanitized, self-contained static markup (Tier 1); "" for procedural graphics
  proc?: string; // Tier 2: linted JS source — body of render(env) → HTML string, evaluated per frame
  params: Record<string, BgParamValue>; // base CSS-variable values
  keyframes: BgKeyframe[]; // tween params over time (--<name>)
  triggers: BgTrigger[]; // one-shot pulses (--pulse)
}

// The argument passed to a Tier-2 procedural graphic's render(env) every frame.
export interface MotionEnv {
  frame: number; // integer frame within the beat
  t: number; // seconds within the beat
  progress: number; // 0 → 1 across the beat
  pulse: number; // 0 → 1 trigger envelope
  params: Record<string, BgParamValue>; // resolved spec params at this frame
  palette: { mint: string; green: string; night: string; white: string; gold: string; font: string };
  width: number; // canvas px (1080 for 9:16)
  height: number; // canvas px (1920 for 9:16)
}

// Brand mark overlay (faceless talking beats): resolved layout + an agent keyframe track.
export interface LogoProps {
  src: string; // staticFile-relative
  sizePx: number;
  x: number; // % of frame (anchored at centre)
  y: number;
  keyframes: BgKeyframe[]; // tween x/y/scale/opacity over time
}

export interface KinoProps {
  theme: Theme;
  fps: number;
  avatar: string | null; // staticFile-relative path to the (trimmed) avatar clip, or null for faceless
  avatarWindows: AvatarWindow[]; // placements of the avatar clip; empty when faceless
  voTrack: string | null; // staticFile-relative path to the full VO audio track
  logo: LogoProps | null; // brand mark shown on faceless talking beats
  background: BackgroundProps; // faceless background engine selection
  disclosure: string;
  segments: KinoSegment[];
}
