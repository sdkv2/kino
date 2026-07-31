// WCAG relative luminance + contrast, and the two ink pickers that keep painted text legible on a
// palette kino did not choose. Pure and dependency-free (textStyles.ts imports it, and that module
// is loaded by the render page).
//
// Why derive at all: the kicker chip ink and the caption stroke were both hardcoded around the house
// palette's dark base and light fg. A light scheme (the `paper` preset, or any custom one) turned
// them into a near-black halo around near-black ink, and dark ink on a dark blue chip. Deriving from
// the palette makes any scheme work; the pickers below are shaped so every dark-base palette still
// resolves to exactly the colours the old constants hardcoded.

/** Parse #rgb / #rrggbb into 0..1 channels. Unparseable input reads as black (the old default) —
 *  including a missing value entirely, so hand-built props without a full theme can't throw here. */
function channels(hex: string): [number, number, number] {
  if (typeof hex !== "string") return [0, 0, 0];
  const h = hex.trim().replace(/^#/, "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) return [0, 0, 0];
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as [number, number, number];
}

/** WCAG 2.x relative luminance (sRGB → linear, ITU-R BT.709 weights). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 (identical) … 21 (black on white). Order-independent. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** A light `bg` wants a flat finish — the film vignette reads as a dirty border on one. */
export function isLightSurface(hex: string): boolean {
  return relativeLuminance(hex) > 0.5;
}

/**
 * Ink for text painted ON `surface`: the palette's `fg` when it clears `floor`, else `bg`.
 *
 * Preferring fg (falling back rather than always maximising contrast) is what keeps the house
 * palette's chips unchanged: a mint or gold chip fails the floor against white and takes the dark
 * base, while the deep-green chip clears it at 4.18 and keeps its white ink — which raw
 * max-contrast would have flipped, since the dark base scores a hair higher there (4.27).
 */
export function readableInk(surface: string, fg: string, bg: string, floor = 4): string {
  if (contrastRatio(surface, fg) >= floor) return fg;
  return contrastRatio(surface, bg) > contrastRatio(surface, fg) ? bg : fg;
}

/**
 * Halo behind a stroked caption glyph — black or white, whichever the ink colour separates from.
 * Every palette with a light `fg` (i.e. every one that predates spec-level colours) yields "#000",
 * exactly the constant this replaced.
 */
export function strokeInk(fg: string): string {
  return contrastRatio(fg, "#000") >= contrastRatio(fg, "#fff") ? "#000" : "#fff";
}
