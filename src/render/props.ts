// Shared prop types for the render composition. Lives in compiled-land so both the
// CLI (render.ts, build.ts) and the render page .tsx (bundled by esbuild) can import it.
import type { CaptionStyle, CaptionAnimation, CaptionReveal, ResolvedText } from "./textStyles.js";
import type { Ease } from "./bgparams.js";
import type { LayerEffect, LayerMask } from "./maskSpec.js";
import type { PostFx } from "./postSpec.js";
import type { WipeSpec } from "./wipeSpec.js";
import type { CameraSpec } from "./cameraSpec.js";
// Type-only: a value import here would create a runtime cycle. layerSpec.ts value-imports Z from
// layers.js, and RESERVED_Z runs `Object.values(Z)` at module top level — see layerSpec.ts's own
// header comment. `import type` is erased at compile time, so it cannot participate in that cycle.
import type { DeclaredLayer } from "./layerSpec.js";
import type { BlendMode } from "./native/page/compositor/graph.js";

export interface Theme {
  font: string;
  fontUrl?: string | null; // staticFile-relative TTF to load (registry font), else system font
  /** Extra brand-font cuts (spec/brand `fontWeights`), so `font-weight` in a motion page selects a
   *  real face instead of silently reusing the single caption cut. Empty/absent = today's behaviour. */
  fontFaces?: { weight: number; url: string }[] | null;
  labelFont?: string; // second typeface (brand.labelFont, defaults to `font`) for motion beats — --kino-label-font
  labelFontUrl?: string | null; // staticFile-relative TTF to load for labelFont, else system font
  bg: string; // page/background base            [was: night]
  accent: string; // primary accent               [was: mint]
  deep: string; // deep fill / active-word colour [was: green]
  accent2: string; // secondary/bright accent     [was: gold]
  fg: string; // text ink                         [was: white]
  brandName?: string; // brand name token; rendered in `deep` wherever it appears in word captions
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

// Per-mask-region shaders for an app beat: the segmentation mask(s) split the frame into a subject
// region (union of every entry's mask>0.5) and a background region (none of them), each running its
// own GLSL body (or a null passthrough of the asset pixels). Up to 4 mask entries (1 is the common
// case); each maskSrc is a public-relative mask.png/mask.mp4, channel says which texel channel
// (from that mask's manifest object) carries its coverage.
export interface RegionShaderMask {
  maskSrc: string; // public-relative mask.png (image) or mask.mp4 (video)
  maskKind: "image" | "video";
  channel: "r" | "g" | "b" | "a" | "gray"; // manifest object's coverage channel
  subjectCode?: string | null; // GLSL body for THIS mask's region; null/absent = the shared subjectCode
}
// A region-shader texture channel (uTex1..uTex3 — uTex0 is always the beat's own asset).
// kind="image": staged file under /public, uploaded once.
// kind="html": sanitized motion markup rasterized (foreignObject) at COMPOSITION size every frame,
// scrubbed by the beat's own progress — the same .html a `motionOverlay` would animate, except it
// lands in the shader as pixels instead of compositing above it.
export interface RegionTexture {
  kind: "image" | "html";
  src: string | null; // public-relative file, for kind="image"
  html: string | null; // sanitized markup, for kind="html"
}

export interface RegionShaderProps {
  // 1..4 entries. Each shades its own region, falling back to subjectCode where it has no
  // subjectCode of its own; later entries paint OVER earlier ones where masks overlap.
  masks: RegionShaderMask[];
  subjectCode: string | null; // GLSL mainImage body for masks without their own, or null = passthrough asset pixels
  backgroundCode: string | null; // GLSL mainImage body elsewhere, or null = passthrough
  // publicDir-relative SECOND source for the background region (image or video), bound to
  // uTex1/uTexSize1 and aliased uBackdrop/uBackdropSize. With backgroundCode null it becomes the
  // background passthrough, cover-fit — the cutout. Video backdrops animate through the per-beat
  // /vframes job `rsbd<i>`.
  backdrop?: string;
  // Author params + tweens shared by EVERY body in this beat's program (subjectCode, backgroundCode
  // and each masks[].subjectCode) — there is ONE uParam0..3 bank in the one program they share, so
  // per-entry sets would need per-entry banks and blow the 4-slot ceiling immediately. Numeric
  // non-reserved names pack into uParam slots as `u_<name>`; colorA/B/C + intensity drive their own
  // uniforms. `keyframes[].at` is BEAT-RELATIVE seconds (0 = beat start) — RegionShader sits inside
  // the beat's Sequence, so its clock is already beat-local and iTime agrees with it.
  params?: Record<string, BgParamValue>;
  keyframes?: BgKeyframe[];
  // Extra sampler channels for every body in this beat: textures[i] → uTex{i+1}, up to 3. Unbound
  // channels sample transparent black, so a body can reference uTex1 whether or not one is declared.
  textures?: RegionTexture[];
}

export interface KinoSegment {
  kind: "scene" | "video" | "motion";
  source?: string; // video beats: the asset path this beat composites
  mask?: LayerMask;          // clip this beat's layers to a shape, file or other layer
  effects?: LayerEffect[];   // per-layer effect chain, applied before compositing
  blend?: BlendMode; // how this beat's main layer composites (default "normal")
  caption: string; // "" = no caption for this beat (spec caption is optional; build coalesces)
  startSec: number;
  endSec: number;
  kicker?: { text: string; color: string; fg: string };
  shot?: string; // resolved camera shot (see render/motion)
  transition?: string; // video cut-ins + motion handoffs (`cut` = hard abut)
  transitionParams?: WipeSpec & Record<string, number | string>; // wipe knobs, or a custom shader's uniforms
  transitionSource?: string; // transition:"custom" — the RESOLVED shader body, read at build time
  transitionInvert?: boolean; // run the transition backwards
  transitionCamera?: CameraSpec; // camera carried through the cut
  /** Keep this beat's motion running through its outgoing handoff instead of holding the last
   *  authored frame. See the hold/carry note in layers.ts. */
  carryMotion?: boolean;
  clipFrom?: number; // seconds into source asset
  clipTo?: number;
  speed?: number; // playbackRate; default 1
  pauseAt?: number; // seconds from segment start → freeze for rest of beat
  frame?: AppFrame;
  regionShader?: RegionShaderProps; // mask-split dual shader for this video beat (subject vs background regions)
  captionMode?: "phrase" | "words"; // "words" = spoken text revealed word-by-word, synced to VO
  words?: WordTiming[]; // absolute word timings (present for captionMode "words")
  emphasis?: string[]; // words to emphasise (glow/pop) in "words" mode
  captionStyle?: CaptionStyle; // resolved look preset (segment ?? spec ?? brand; undefined = "stroke")
  captionAnimation?: CaptionAnimation; // resolved preset (overlays + spec contract); native caption raster keeps quad-level legacy entrance — see textStyles.ts
  captionReveal?: CaptionReveal; // words-mode reveal: "word" (per-word pop, default) | "all" (whole line, highlight tracks VO)
  texts?: ResolvedText[]; // standalone stylised text overlays, absolute-timed
  captionKeyframes?: BgKeyframe[]; // tween the caption (x/y offset %, scale, opacity)
  kickerKeyframes?: BgKeyframe[]; // tween the kicker (video segments)
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
  ease?: Ease;
}
export interface BgTrigger {
  at: number;
  action: string;
}
// A shader-background texture channel (uTex0..uTex3), resolved at build time.
// kind="image": staged file under /public. kind="html": sanitized motion-style markup the page
// rasterizes (foreignObject) — brand fonts and --kino-* palette vars apply. With `param` set, the
// markup is re-rasterized EVERY FRAME at that background param's value (0..1 → the markup's 1s
// CSS @keyframes) — true per-frame animation. Without it, a single static raster.
// kind="video": staged .mp4/.webm under /public (e.g. a segmentation mask), seeked to frame/fps and
// drawn to a canvas EVERY FRAME so uTexN sees this frame's pixels.
export interface BgTexture {
  kind: "image" | "html" | "video";
  src: string | null; // public-relative file, for kind="image" | "video"
  html: string | null; // sanitized markup, for kind="html"
  param?: string; // html only: per-frame scrub driven by this background param (0..1)
}

export interface BackgroundProps {
  kind: "glow" | "image" | "mesh" | "aurora" | "particles" | "grid" | "solid" | "custom";
  image: string | null; // staticFile-relative path, for kind="image"
  customCode: string | null; // Canvas2D draw-fn source, for kind="custom" (.js)
  shaderCode: string | null; // GLSL mainImage body, for kind="custom" (.frag/.glsl)
  textures?: BgTexture[]; // shader texture channels uTex0..uTex3 (empty/absent for non-shader kinds)
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
  /** Lens material GLSL keyed by `data-lens` id (default `liquid-glass`). Filled at resolve/hydrate. */
  lensShaders?: Record<string, string>;
}

// One deterministic simplex-noise field per dimensionality. Same seed → same field, always.
export interface ProcNoiseSet {
  noise2D: (x: number, y: number) => number;
  noise3D: (x: number, y: number, z: number) => number;
  noise4D: (x: number, y: number, z: number, w: number) => number;
}

// The Tier-2 standard library on env.lib — three pure, bundled libraries (no imports in procs).
// Implemented by src/render/procLib.ts; attached to env in motionFrameState (page + dump-html).
export interface ProcLib extends ProcNoiseSet {
  /** d3-shape: line/area/arc/pie/stack generators, curve + symbol factories. Headless (path strings). */
  shape: typeof import("d3-shape");
  /** culori: color parsing, conversion, mixing, interpolation (oklch et al.). */
  color: typeof import("culori");
  /** Mint an independent deterministic noise field (e.g. one per series). */
  seedNoise(seed: string | number): ProcNoiseSet;
}

// The argument passed to a Tier-2 procedural graphic's render(env) every frame.
export interface MotionEnv {
  frame: number; // integer frame within the beat
  t: number; // seconds within the beat
  progress: number; // 0 → 1 across the beat (linear)
  /** Ease-in cubic of progress — slow start, fast finish. */
  in: number;
  /** Ease-out cubic of progress — fast start, soft landing. */
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
  /** |cam[t] − cam[t−1]| × fps when the spec defines `cam`; else 0. */
  camVel: number;
  /** px-ready blur strength for `.kino-camera` (0 when settled or no `cam` param). */
  camBlur: number;
  palette: {
    bg: string; fg: string; accent: string; accent2: string; deep: string;
    // Legacy literal-name aliases (pre-rename Tier-2 pages) — same values as the roles.
    mint: string; green: string; night: string; white: string; gold: string;
    font: string;
  };
  width: number; // canvas px (1080 for 9:16)
  height: number; // canvas px (1920 for 9:16)
  words: WordTiming[]; // beat's spoken words, beat-relative (start/end in seconds from beat start); [] when none
  durationFrames: number; // total frames in the beat; last frame index = durationFrames - 1
  duration: number; // beat length in seconds
  lib: ProcLib; // bundled chart/noise/color stdlib — see ProcLib
}

// A staged sound-effect event (staticFile-relative src, absolute timeline seconds).
// `pan`/`rate` are OMITTED at their defaults rather than written as 0/1: sfx is part of the
// frame-cache key (render/native/frameCache), and JSON.stringify drops undefined, so an existing
// project's cache keeps serving instead of cold-starting on a field that changes no pixels.
export interface SfxProps {
  src: string;
  at: number;
  volume: number;
  pan?: number; // -1 hard left … 1 hard right; undefined = centre (no pan filter emitted)
  rate?: number; // varispeed multiplier; undefined = 1 (no rate filter emitted)
}

// Music bed under the VO. duckSpans = the per-segment VO-active spans the bed ducks under
// (segment-level, not word-level — word gaps would make the bed flutter).
export interface MusicProps {
  src: string;
  volume: number;
  duck: number;
  fadeInSec: number;
  fadeOutSec: number;
  startSec: number; // decode offset into the source file (0 = play from the top)
  duckSpans: Array<{ from: number; to: number }>;
  keyframes?: MusicKeyframeProps[]; // hand-keyed bed level; `volume` is the implicit t=0 key
}

export interface MusicKeyframeProps {
  at: number; // absolute seconds on the main timeline
  params: { volume: number };
  ease?: Ease;
}

export interface KinoProps {
  theme: Theme;
  fps: number;
  avatar: string | null; // staticFile-relative path to the (trimmed) presenter clip, or null when there is none
  avatarWindows: AvatarWindow[]; // placements of the presenter clip; empty when there is no presenter
  voTrack: string | null; // staticFile-relative path to the full VO audio track
  background: BackgroundProps; // background engine selection
  disclosure: string;
  sfx?: SfxProps[]; // free-placed sound effects
  music?: MusicProps[] | null; // music beds, all ducked under the same VO spans
  /** Gain on the whole VO track. Omitted at the default (1) so the frame-cache key is unchanged. */
  voVolume?: number;
  segments: KinoSegment[];
  /** Author-declared layers, sorted into the built-in stack by z. See render/layerSpec.ts. */
  layers?: DeclaredLayer[];
  /** Full-frame post stage: grade → bloom → lens → film (compositor only). */
  postFx?: PostFx;
  /** Automatic camera motion blur (spec `motionBlur`, default true). False disables the derived smear
   *  on fast camera moves; a hand-authored `motionBlur` effect is always honoured either way. */
  motionBlur?: boolean;
  /** Still/storyboard only — in-feed safe-zone overlay. Never set by `kino build`. */
  platformGuide?: "tiktok" | "reels";
  /** Still only — rule-of-thirds grid overlay for composition QA. Never set by `kino build`. */
  grid?: boolean;
}
