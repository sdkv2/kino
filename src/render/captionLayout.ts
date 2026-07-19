import type { KinoSegment } from "./props.js";

// px from the frame bottom where the auto caption band sits (its bottom edge). The band grows upward
// from here. Single source of truth — Caption/WordCaption render here, and it's exposed to motion
// graphics as the --kino-caption-bottom CSS var so authors can keep their own text clear of it.
export const CAPTION_BOTTOM = 470;

/** Faceless talking beats (including CTA end cards) centre the caption as the hero. */
export function isHeroCaption(s: Pick<KinoSegment, "kind" | "cta">, hasAvatar: boolean): boolean {
  return !hasAvatar && s.kind === "avatar";
}

/** Whether this beat draws any caption at all: word-synced words, or non-blank caption text.
 *  Single guard shared by layout (band reservation) and render (mounting the caption node). */
export function hasCaptionContent(s: KinoSegment): boolean {
  const wordMode = s.captionMode === "words" && !!s.words && s.words.length > 0;
  return wordMode || !!(s.caption && s.caption.trim());
}

// The caption band bottom (px) a motion beat should reserve, or 0 when nothing sits in the bottom band
// for this beat: an empty caption, or a faceless avatar beat whose caption is the centered hero text.
export function captionBandBottom(s: KinoSegment, hasAvatar: boolean): number {
  if (isHeroCaption(s, hasAvatar)) return 0;
  return hasCaptionContent(s) ? CAPTION_BOTTOM : 0;
}
