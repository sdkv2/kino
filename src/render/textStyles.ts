// Text preset library + build-time resolvers for stylised captions and overlays. Pure module
// (compiled-land, like captionLayout.ts): the CLI resolves specs through it and the Remotion
// components style words with it. Presets draw only from the resolved brand palette.
// Spec: docs/superpowers/specs/2026-07-18-stylised-text-design.md
import type { CSSProperties } from "react";

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
  night: string;
  mint: string;
  green: string;
  white: string;
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
        ? { color: t.night, backgroundColor: t.mint, borderRadius: 6, padding: "0px 16px", fontWeight: 900 }
        : { color: t.white, borderRadius: 6, padding: "0px 16px", fontWeight: 900, textShadow: shadow };
    case "gradient":
      // background-clip fill conflicts with text stroke and textShadow — legibility comes from a
      // drop-shadow filter instead.
      return {
        fontWeight: 900,
        backgroundImage: `linear-gradient(100deg, ${t.mint}, ${t.green})`,
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
        filter: emph ? `drop-shadow(0 0 18px ${t.mint})` : "drop-shadow(0 6px 14px rgba(0,0,0,.5))",
      };
    case "minimal":
      return { color: highlight ? t.mint : t.white, fontWeight: 700, textShadow: "0 4px 14px rgba(0,0,0,.35)" };
    default:
      // "stroke" — the legacy look, byte-for-byte.
      return {
        color: highlight ? t.mint : t.white,
        fontWeight: 900,
        WebkitTextStroke: `${t.captionStroke}px #000`,
        paintOrder: "stroke fill" as CSSProperties["paintOrder"],
        textShadow: emph ? `0 0 26px ${t.mint}` : shadow,
      };
  }
}

// Whole-line box: highlight style gets an opaque night plate; otherwise the legacy translucent
// backplate when configured (absorbs components.tsx plateStyle). {} = unchanged look.
export function lineBoxStyle(style: CaptionStyle, t: TextTheme, backplateBg?: string | null): CSSProperties {
  if (style === "highlight") return { display: "inline-block", backgroundColor: t.night, padding: "12px 32px", borderRadius: 12 };
  if (backplateBg) return { display: "inline-block", backgroundColor: backplateBg, padding: "12px 32px", borderRadius: 12 };
  return {};
}

// s = entrance spring 0→1 (caller owns the spring config); frame = frames since this element's
// entrance began (negative = not yet — words mode passes revealFrame); index = word index for
// stagger phase. Callers use these presets only for NON-native animations; native entrances keep
// their legacy inline math (regression gate).
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

// Slot → (x, y) % of frame, element anchored at its centre (same convention as LOGO_POSITIONS).
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
