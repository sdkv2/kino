// Shared prop types for the render composition. Lives in compiled-land so both the
// CLI (render.ts, build.ts) and the render page .tsx (bundled by esbuild) can import it.
import type { CaptionStyle, CaptionAnimation, CaptionReveal, ResolvedText } from "./textStyles.js";

export interface Theme {
  font: string;
  fontUrl?: string | null; // staticFile-relative TTF to load (registry font), else system font
  labelFont?: string; // second typeface (brand.labelFont, defaults to `font`) for motion beats — --kino-label-font
  labelFontUrl?: string | null; // staticFile-relative TTF to load for labelFont, else system font
  night: string;
  mint: string;
  green: string;
  gold: string;
  white: string;
  brandName?: string; // brand name token; rendered green wherever it appears in word captions
  captionFontSize: number;
  captionStroke: number;
  captionBg?: { bg: string; appOnly: boolean } | null; // translucent plate behind lower-third captions (opt-in)
  film?: number; // 0..1 cinematic-finish intensity (spec `film`, default 1); 0 = no vignette/grain
}

// One spoken word and its absolute on-timeline span (from the VO timestamps).
export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

/** Chrome overlay for an app cut-in: footage sits in inset (% of composition), src is full-bleed on top. */
export interface AppFrame {
  src: string; // staticFile-relative
  inset: { x: number; y: number; w: number; h: number }; // % of composition
}

export interface KinoSegment {
  kind: "avatar" | "app" | "motion";
  asset?: string;
  caption: string; // "" = no caption for this beat (spec caption is optional; build coalesces)
  startSec: number;
  endSec: number;
  /** Faceless avatar beats (including cta:true end cards) use centered hero captions. */
  cta?: boolean;
  kicker?: { text: string; color: string; fg: string };
  shot?: string; // resolved camera shot (see render/motion)
  transition?: string; // resolved in/out transition for app cut-ins
  clipFrom?: number; // seconds into source asset
  clipTo?: number;
  speed?: number; // playbackRate; default 1
  pauseAt?: number; // seconds from segment start → freeze for rest of beat
  frame?: AppFrame;
  captionMode?: "phrase" | "words"; // "words" = spoken text revealed word-by-word, synced to VO
  words?: WordTiming[]; // absolute word timings (present for captionMode "words")
  emphasis?: string[]; // words to emphasise (glow/pop) in "words" mode
  captionStyle?: CaptionStyle; // resolved look preset (segment ?? spec ?? brand; undefined = "stroke")
  captionAnimation?: CaptionAnimation; // resolved entrance preset (undefined = the surface's native entrance)
  captionReveal?: CaptionReveal; // words-mode reveal: "word" (per-word pop, default) | "all" (whole line, highlight tracks VO)
  texts?: ResolvedText[]; // standalone stylised text overlays, absolute-timed
  captionKeyframes?: BgKeyframe[]; // tween the caption (x/y offset %, scale, opacity)
  kickerKeyframes?: BgKeyframe[]; // tween the kicker (app segments)
  zoomKeyframes?: BgKeyframe[]; // camera push/pan on the footage+chrome group (beat-relative: at = sec from beat start)
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
  kind: "glow" | "image" | "mesh" | "aurora" | "particles" | "grid" | "solid" | "custom";
  image: string | null; // staticFile-relative path, for kind="image"
  customCode: string | null; // draw-fn source, for kind="custom"
  params: Record<string, BgParamValue>; // base param values (tweened by keyframes)
  keyframes: BgKeyframe[]; // agent-authored param tweens over time
  triggers: BgTrigger[]; // agent-authored one-shot actions (e.g. pulse)
}

// A parsed Lottie (Bodymovin) animation document. Structurally JSON, so it serializes cleanly
// through the render-page config. Validated + linted at resolve time (src/render/lottie.ts).
export type LottieData = Record<string, unknown>;

// A resolved motion graphic: the sanitized HTML plus the JSON-owned timing controls.
export interface MotionGraphicProps {
  html: string; // sanitized static markup (Tier 1); "" for procedural AND lottie graphics
  proc?: string; // Tier 2: linted JS source — body of render(env) → HTML string, evaluated per frame
  lottie?: LottieData; // Tier 3: parsed animationData
  loop?: boolean; // Tier 3 playback (inert for html/proc); default false
  params: Record<string, BgParamValue>; // base CSS-variable values
  keyframes: BgKeyframe[]; // tween params over time (--<name>)
  triggers: BgTrigger[]; // one-shot pulses (--pulse)
  words?: WordTiming[]; // beat-relative spoken-word spans, for typed-in-sync graphics (env.words + --kino-words-shown)
}

// The argument passed to a Tier-2 procedural graphic's render(env) every frame.
export interface MotionEnv {
  frame: number; // integer frame within the beat
  t: number; // seconds within the beat
  progress: number; // 0 → 1 across the beat (linear)
  /** Ease-out cubic of progress — soft landings without hand-rolled (1-p)^n. */
  out: number;
  /** Smoothstep of progress. */
  inout: number;
  /** Back-out of progress (may exceed 1 mid-way). */
  overshoot: number;
  /** Elastic-out of progress (may exceed 1 mid-way). */
  spring: number;
  /** sin(progress·π) — 0 at beat edges, 1 mid (seam-safe life). */
  edge: number;
  pulse: number; // 0 → 1 trigger envelope (fast attack, exponential decay)
  params: Record<string, BgParamValue>; // resolved spec params at this frame
  palette: { mint: string; green: string; night: string; white: string; gold: string; font: string };
  width: number; // canvas px (1080 for 9:16)
  height: number; // canvas px (1920 for 9:16)
  words: WordTiming[]; // beat's spoken words, beat-relative (start/end in seconds from beat start); [] when none
  durationFrames: number; // total frames in the beat; last frame index = durationFrames - 1
  duration: number; // beat length in seconds
}

// Brand mark overlay (faceless talking beats): resolved layout + an agent keyframe track.
export interface LogoProps {
  src: string; // staticFile-relative
  sizePx: number;
  x: number; // % of frame (anchored at centre)
  y: number;
  keyframes: BgKeyframe[]; // tween x/y/scale/opacity over time
}

// A staged sound-effect event (staticFile-relative src, absolute timeline seconds).
export interface SfxProps {
  src: string;
  at: number;
  volume: number;
}

// Music bed under the VO. duckSpans = the per-segment VO-active spans the bed ducks under
// (segment-level, not word-level — word gaps would make the bed flutter).
export interface MusicProps {
  src: string;
  volume: number;
  duck: number;
  fadeInSec: number;
  fadeOutSec: number;
  duckSpans: Array<{ from: number; to: number }>;
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
  sfx?: SfxProps[]; // free-placed sound effects
  music?: MusicProps | null; // music bed, ducked while VO speaks
  segments: KinoSegment[];
  /** Still/storyboard only — in-feed safe-zone overlay. Never set by `kino build`. */
  platformGuide?: "tiktok" | "reels";
  /** Still only — rule-of-thirds grid overlay for composition QA. Never set by `kino build`. */
  grid?: boolean;
}
