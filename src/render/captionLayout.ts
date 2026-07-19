import type { KinoSegment } from "./props.js";

// px from the frame bottom where the auto caption band sits (its bottom edge). The band grows upward
// from here. Single source of truth — Caption/WordCaption render here, and it's exposed to motion
// graphics as the --kino-caption-bottom CSS var so authors can keep their own text clear of it.
export const CAPTION_BOTTOM = 470;

/** Faceless talking beats centre the caption as the hero — except CTA beats, which stay lower-third. */
export function isHeroCaption(s: Pick<KinoSegment, "kind" | "cta">, hasAvatar: boolean): boolean {
  return !hasAvatar && s.kind === "avatar" && !s.cta;
}

// The caption band bottom (px) a motion beat should reserve, or 0 when nothing sits in the bottom band
// for this beat: an empty caption, or a faceless avatar beat whose caption is the centered hero text.
export function captionBandBottom(s: KinoSegment, hasAvatar: boolean): number {
  if (isHeroCaption(s, hasAvatar)) return 0;
  const wordMode = s.captionMode === "words" && !!s.words && s.words.length > 0;
  const hasCaption = wordMode || !!(s.caption && s.caption.trim());
  return hasCaption ? CAPTION_BOTTOM : 0;
}
