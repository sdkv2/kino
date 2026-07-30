// Curated popular fonts, downloaded on demand (see manager.ts). Each carries a one-line
// description so `kino fonts` is self-documenting. weight = the cut fetched for captions.
export interface FontDef {
  name: string; // registry key + the value to put in brand.font
  family: string; // CSS font-family / Google Fonts family
  description: string;
  weight: number;
}

/** Extra cuts a brand may opt into with `fontWeights`, beyond the caption weight above.
 *
 *  Only one cut per family is staged by default, and it is a heavy one because captions want heft.
 *  That makes `font-weight` a silent no-op inside a motion page: there is a single face, so a page
 *  asking for Medium gets the 800 anyway. Two independent authors hit this trying to match a
 *  reference's lighter geometric sans and had to compensate with letter-spacing.
 *
 *  Opt-in rather than staged always: the face bytes are base64-inlined into every SVG raster, so
 *  fetching four cuts for a project that never asks would multiply that payload for nothing. */
export const SELECTABLE_WEIGHTS = [200, 300, 400, 500, 600, 700, 800, 900] as const;

/** Which cuts of the brand font to stage, given the caption weight and the two places that may ask.
 *
 *  Spec `fontWeights` **overrides** brand `fontWeights` rather than merging with it: the spec is the
 *  more specific declaration (same precedence as `background` / `captionMode`), and a merge would
 *  make it impossible to ask for *fewer* cuts than the brand stages. That is why an explicit empty
 *  array is meaningful — it opts a lean spec out of a type-heavy brand's set.
 *
 *  The caption weight is always in a non-empty result, so a page that asks for it still resolves.
 *  Empty result = today's default: one staged face answering every `font-weight`. */
export function resolveFontCuts(
  captionWeight: number,
  specWeights: number[] | undefined,
  brandWeights: number[] | undefined,
): number[] {
  const declared = specWeights ?? brandWeights;
  if (!declared?.length) return [];
  return [...new Set([captionWeight, ...declared])].sort((a, b) => a - b);
}

export const FONTS: FontDef[] = [
  { name: "Inter", family: "Inter", description: "Clean, neutral UI sans — safe default for body + captions.", weight: 800 },
  { name: "Poppins", family: "Poppins", description: "Rounded geometric sans — friendly, modern, very popular.", weight: 700 },
  { name: "Montserrat", family: "Montserrat", description: "Geometric sans with character — strong for titles.", weight: 800 },
  { name: "Roboto", family: "Roboto", description: "Neutral workhorse sans — highly legible everywhere.", weight: 700 },
  { name: "Outfit", family: "Outfit", description: "Modern geometric sans — sleek and trendy.", weight: 800 },
  { name: "Plus Jakarta Sans", family: "Plus Jakarta Sans", description: "Contemporary humanist sans — premium SaaS feel.", weight: 800 },
  { name: "Oswald", family: "Oswald", description: "Condensed sans — bold, space-efficient captions.", weight: 600 },
  { name: "Bebas Neue", family: "Bebas Neue", description: "Tall condensed all-caps display — classic title look.", weight: 400 },
  { name: "Anton", family: "Anton", description: "Ultra-bold display — huge, punchy TikTok-style captions.", weight: 400 },
  { name: "Archivo Black", family: "Archivo Black", description: "Heavy grotesque display — high-impact headlines.", weight: 400 },
  { name: "Space Grotesk", family: "Space Grotesk", description: "Technical geometric sans — engineered, spec-sheet feel.", weight: 700 },
  { name: "Playfair Display", family: "Playfair Display", description: "High-contrast editorial serif — luxury titles and fashion headlines.", weight: 700 },
  { name: "Cormorant Garamond", family: "Cormorant Garamond", description: "Refined garamond serif — quiet, premium elegance.", weight: 600 },
  { name: "IBM Plex Mono", family: "IBM Plex Mono", description: "Editorial monospace — labels, data, terminal aesthetics.", weight: 600 },
];

export function lookupFont(name: string): FontDef | undefined {
  const n = name.trim().toLowerCase();
  return FONTS.find((f) => f.name.toLowerCase() === n);
}
