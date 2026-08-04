// Text preset library + build-time resolvers for stylised captions and overlays. Pure module
// (compiled-land, like captionLayout.ts): the CLI resolves specs through it and the render-page
// components style words with it. Presets draw only from the resolved brand palette.
import type { CSSProperties } from "react";
import { strokeInk } from "./contrast.js";

export const CAPTION_STYLES = ["stroke", "highlight", "gradient", "minimal"] as const;
export const CAPTION_ANIMATIONS = ["pop", "rise", "typewriter", "wave", "blur-in", "none"] as const;
// Words-mode reveal: "word" = each word pops in at its VO time (default); "all" = the whole caption
// is laid out and faded in together, the active word highlighting as the VO reaches it (no per-word
// entrance — a long line can't strand its first word at a wrapped corner during a VO pause).
export const CAPTION_REVEALS = ["word", "all"] as const;
export type CaptionStyle = (typeof CAPTION_STYLES)[number];
export type CaptionAnimation = (typeof CAPTION_ANIMATIONS)[number];
export type CaptionReveal = (typeof CAPTION_REVEALS)[number];

// Structural subset of Theme (props.ts) — kept import-free so props.ts can import from here.
export interface TextTheme {
  bg: string; // [was: night]
  accent: string; // [was: mint]
  deep: string; // [was: green]
  fg: string; // [was: white]
  captionStroke: number;
}

// highlight = this word takes the accent (active/brand word in words mode); emph = extra glow
// (active + emphasised); shadow = surface-specific drop shadow (each caption surface keeps its
// legacy value so the default render stays pixel-identical).
export interface WordFlags {
  highlight?: boolean;
  emph?: boolean;
  shadow?: string;
}

// Per-word ink: colour/weight/stroke/shadow (and box, for highlight) for one style preset.
export function wordStyle(style: CaptionStyle, t: TextTheme, flags: WordFlags = {}): CSSProperties {
  const { highlight = false, emph = false, shadow = "0 6px 18px rgba(0,0,0,.45)" } = flags;
  switch (style) {
    case "highlight":
      // CapCut-style: the accented word sits in a rounded mint box with night ink; the rest is
      // plain white (no stroke — the box carries the contrast). Every word carries the same
      // padding so the box is paint-only: a padding delta on just the active word moves the
      // flex wrap point and makes words jump between rows as the highlight travels.
      return highlight
        ? { color: t.bg, backgroundColor: t.accent, borderRadius: 6, padding: "0px 16px", fontWeight: 900 }
        : { color: t.fg, borderRadius: 6, padding: "0px 16px", fontWeight: 900, textShadow: shadow };
    case "gradient":
      // background-clip fill conflicts with text stroke and textShadow — legibility comes from a
      // drop-shadow filter instead.
      return {
        fontWeight: 900,
        backgroundImage: `linear-gradient(100deg, ${t.accent}, ${t.deep})`,
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
        filter: emph ? `drop-shadow(0 0 18px ${t.accent})` : "drop-shadow(0 6px 14px rgba(0,0,0,.5))",
      };
    case "minimal":
      return { color: highlight ? t.accent : t.fg, fontWeight: 700, textShadow: "0 4px 14px rgba(0,0,0,.35)" };
    default:
      // "stroke" — the legacy look. The halo is derived rather than hardcoded black: on a light
      // scheme, black behind near-black ink is a blob. Any light `fg` (every palette that predates
      // spec-level colours) still yields "#000".
      return {
        color: highlight ? t.accent : t.fg,
        fontWeight: 900,
        WebkitTextStroke: `${t.captionStroke}px ${strokeInk(t.fg)}`,
        paintOrder: "stroke fill" as CSSProperties["paintOrder"],
        textShadow: emph ? `0 0 26px ${t.accent}` : shadow,
      };
  }
}

// Whole-line box: highlight style gets an opaque night plate; otherwise the legacy translucent
// backplate when configured (absorbs components.tsx plateStyle). {} = unchanged look.
export function lineBoxStyle(style: CaptionStyle, t: TextTheme, backplateBg?: string | null): CSSProperties {
  if (style === "highlight") return { display: "inline-block", backgroundColor: t.bg, padding: "12px 32px", borderRadius: 12 };
  if (backplateBg) return { display: "inline-block", backgroundColor: backplateBg, padding: "12px 32px", borderRadius: 12 };
  return {};
}

// s = entrance spring 0→1 (caller owns the spring config); frame = frames since this element's
// entrance began (negative = not yet — words mode passes revealFrame); index = word index for
// stagger phase.
export interface AnimInput {
  s: number;
  frame: number;
  index: number;
}
export interface AnimOut {
  transform: string;
  opacity: number;
  filter?: string;
}

export function animatePreset(anim: CaptionAnimation, a: AnimInput): AnimOut {
  const settle = Math.min(1, a.s); // clamped spring for opacity/blur (no overshoot artefacts)
  switch (anim) {
    case "rise":
      return { transform: `translateY(${(1 - a.s) * 44}px)`, opacity: settle };
    case "typewriter":
      return { transform: "none", opacity: a.frame >= 0 ? 1 : 0 };
    case "wave": {
      // ponytail: fixed 6px bob at ~0.5Hz (30fps), 4-frame phase step per word; entrance rides the spring
      const bob = Math.sin((a.frame - a.index * 4) / 9) * 6 * settle;
      return { transform: `translateY(${bob}px) scale(${0.7 + 0.3 * settle})`, opacity: settle };
    }
    case "blur-in":
      return { transform: "none", opacity: settle, filter: `blur(${(1 - settle) * 12}px)` };
    case "none":
      return { transform: "none", opacity: a.frame >= 0 ? 1 : 0 };
    default:
      // "pop"
      return { transform: `scale(${0.7 + 0.3 * a.s})`, opacity: Math.min(1, a.s * 2) };
  }
}

// CSS `filter` is a single property — merge a style filter (gradient drop-shadow) with an
// animation filter (blur-in) into one value.
export function composeFilters(...fs: Array<string | undefined>): string | undefined {
  const list = fs.filter((f): f is string => !!f && f !== "none");
  return list.length ? list.join(" ") : undefined;
}

// --- captionAnimation in the native raster ---------------------------------------------------
//
// THE ARCHITECTURE, and why it is neither of the two obvious options.
//
// The caption raster is keyed by the active word, so it re-renders when the word changes and never
// between — which is why an entrance spring had nowhere to ride, and why every animation preset
// painted as its settled pose. The two candidate fixes each fail on their own:
//
//   an animated QUAD  — layers.ts already tweens the caption quad, and a whole-line pop is
//                       expressible there for free. But in words mode each word enters at its own
//                       VO time, and one quad transform cannot stagger. `wave` and `typewriter`
//                       are per-element by definition. So the quad can never carry the presets.
//   a DYNAMIC cadence — re-raster every frame, and everything works. But it also re-rasters for
//                       every frame a caption is merely SITTING there, which is most of them, and
//                       the raster is the expensive layer (fonts inlined, foreignObject decode).
//
// What actually splits cleanly is the TEMPLATE from the PIXELS. The markup — which word is
// highlighted, which ink each word takes — still changes only on word boundaries, so the expensive
// font-inlined template stays keyed exactly as it is today. The animation is injected as a bundle
// of CSS custom properties computed per frame, so the same template rasters to a different pose.
// And because the markup reads them through `var(--ka0-t, none)` fallbacks, a frame with NO vars
// paints the settled pose — so once every entrance has landed the caller stops emitting them, the
// cache key collapses back to the plain template key, and the rest of the beat is served from the
// keyed raster it always was.
//
// Net: per-frame work for exactly the frames that are moving. `wave` is the honest exception — a
// continuous bob never settles, and an author asking for one is asking for per-frame rasters.

/** Entrance length. ~8 frames at 30fps: long enough to read as a spring, short enough that the
 *  per-frame rasters it costs are a rounding error on a beat. */
export const CAPTION_ENTRANCE_SEC = 0.28;
/** Per-word stagger for the presets whose identity IS the stagger, when there are no VO word times
 *  to stagger against (a phrase caption). */
export const CAPTION_STAGGER_SEC = 0.06;
/** Presets that read as a cascade rather than one move, so a phrase caption staggers them. */
const STAGGERED = new Set<CaptionAnimation>(["typewriter", "wave"]);
/** Presets that never settle — the motion is the preset, not an entrance into it. */
const CONTINUOUS = new Set<CaptionAnimation>(["wave"]);

/**
 * When each animated word's entrance begins, in absolute seconds.
 *
 * Words mode rides the VO: a word enters when it is spoken, which is the entire reason captions are
 * word-keyed in the first place. `reveal: "all"` lays the whole line out at once by contract, so
 * there is nothing per-word to ride and every word shares the beat's start.
 */
export function captionAnimStarts(opts: {
  anim: CaptionAnimation;
  count: number;
  beatStartSec: number;
  wordStartsSec?: number[];
  perWord: boolean;
}): number[] {
  const { anim, count, beatStartSec, wordStartsSec, perWord } = opts;
  if (perWord && wordStartsSec?.length) {
    return Array.from({ length: count }, (_, i) => wordStartsSec[i] ?? beatStartSec);
  }
  const step = STAGGERED.has(anim) ? CAPTION_STAGGER_SEC : 0;
  return Array.from({ length: count }, (_, i) => beatStartSec + i * step);
}

/** True once no word's pose can change again, so the raster can go back to being keyed. */
export function captionAnimSettled(anim: CaptionAnimation, starts: number[], tAbs: number): boolean {
  if (CONTINUOUS.has(anim)) return false;
  if (!starts.length) return true;
  return tAbs >= Math.max(...starts) + CAPTION_ENTRANCE_SEC;
}

/** Elastic-out, the same shape bgparams' `spring` curve has. Duplicated rather than imported
 *  because textStyles.ts is the one text module props.ts imports FROM, and a value import back
 *  into bgparams would close a cycle. */
function springAt(p: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  return 1 + Math.pow(2, -10 * p) * Math.sin(((p * 10 - 0.75) * (2 * Math.PI)) / 3);
}

/**
 * The per-frame custom properties a caption raster reads: `--ka{i}-t/-o/-f` per word.
 *
 * Every number comes out of `animatePreset`, the same library the DOM composition used, so the two
 * surfaces cannot drift into two different definitions of "pop". Returns "" when nothing is moving
 * — that empty string is load-bearing, since it is what lets the caller fall back to the settled
 * raster instead of minting a new one.
 */
export function captionAnimVars(opts: {
  anim: CaptionAnimation;
  starts: number[];
  tAbs: number;
  fps: number;
}): string {
  const { anim, starts, tAbs, fps } = opts;
  if (captionAnimSettled(anim, starts, tAbs)) return "";
  const out: string[] = [];
  starts.forEach((start, i) => {
    const elapsed = tAbs - start;
    const a = animatePreset(anim, {
      s: springAt(elapsed / CAPTION_ENTRANCE_SEC),
      frame: Math.round(elapsed * fps),
      index: i,
    });
    out.push(`--ka${i}-t:${a.transform}`);
    out.push(`--ka${i}-o:${a.opacity}`);
    // Omitted rather than written as `none`: the markup reads it as `var(--ka0-f,)`, and an empty
    // value is a valid (absent) filter while `none` beside another filter function is not.
    if (a.filter) out.push(`--ka${i}-f:${a.filter}`);
  });
  return out.join(";");
}

// Layered caption look: segment ?? spec ?? brand ?? defaults. animation stays undefined when no
// layer sets it — each surface then keeps its native entrance (pop, or rise for hero text).
export function resolveCaptionLook(
  seg: { captionStyle?: CaptionStyle; captionAnimation?: CaptionAnimation; captionReveal?: CaptionReveal },
  spec: { captionStyle?: CaptionStyle; captionAnimation?: CaptionAnimation; captionReveal?: CaptionReveal },
  brand?: { style?: CaptionStyle; animation?: CaptionAnimation; reveal?: CaptionReveal },
): { style: CaptionStyle; animation?: CaptionAnimation; reveal: CaptionReveal } {
  return {
    style: seg.captionStyle ?? spec.captionStyle ?? brand?.style ?? "stroke",
    animation: seg.captionAnimation ?? spec.captionAnimation ?? brand?.animation,
    reveal: seg.captionReveal ?? spec.captionReveal ?? brand?.reveal ?? "word",
  };
}

// --- Standalone text overlays --------------------------------------------------------------------

// Size names are multipliers of the brand captionFontSize.
export const TEXT_SIZES: Record<"small" | "medium" | "big", number> = { small: 0.7, medium: 1, big: 1.5 };

// Slot → (x, y) % of frame, element anchored at its centre.
// bottom sits above the caption band (CAPTION_BOTTOM); side slots are inset for 9:16 safe areas.
export const TEXT_POSITIONS: Record<"top" | "center" | "bottom" | "left" | "right", { x: number; y: number }> = {
  top: { x: 50, y: 16 },
  center: { x: 50, y: 45 },
  bottom: { x: 50, y: 72 },
  left: { x: 26, y: 45 },
  right: { x: 74, y: 45 },
};

// A spec `texts[]` entry (post-zod: position/size defaulted).
export interface SpecText {
  text: string;
  at: number;
  dur?: number;
  position: keyof typeof TEXT_POSITIONS;
  size: keyof typeof TEXT_SIZES;
  style?: CaptionStyle;
  animation?: CaptionAnimation;
}

// Render-ready overlay: absolute timeline seconds, % position, px size, resolved presets.
export interface ResolvedText {
  text: string;
  fromSec: number;
  durSec: number;
  x: number;
  y: number;
  sizePx: number;
  style: CaptionStyle;
  animation: CaptionAnimation;
}

// `at` is relative to the segment start; entries are clamped to the beat (an overlay never
// outlives its segment) and dropped when they'd start after it ends.
export function resolveTexts(
  texts: SpecText[] | undefined,
  segStartSec: number,
  segEndSec: number,
  captionFontSize: number,
  fallback: { style: CaptionStyle; animation?: CaptionAnimation },
): ResolvedText[] | undefined {
  if (!texts || texts.length === 0) return undefined;
  const out: ResolvedText[] = [];
  for (const tx of texts) {
    const fromSec = segStartSec + tx.at;
    if (fromSec >= segEndSec) continue;
    const pos = TEXT_POSITIONS[tx.position];
    out.push({
      text: tx.text,
      fromSec,
      durSec: Math.min(tx.dur ?? segEndSec - fromSec, segEndSec - fromSec),
      x: pos.x,
      y: pos.y,
      sizePx: Math.round(captionFontSize * TEXT_SIZES[tx.size]),
      style: tx.style ?? fallback.style,
      animation: tx.animation ?? fallback.animation ?? "pop",
    });
  }
  return out.length ? out : undefined;
}
