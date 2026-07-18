// Curated popular fonts, downloaded on demand (see manager.ts). Each carries a one-line
// description so `kino fonts` is self-documenting. weight = the cut fetched for captions.
export interface FontDef {
  name: string; // registry key + the value to put in brand.font
  family: string; // CSS font-family / Google Fonts family
  description: string;
  weight: number;
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
  { name: "IBM Plex Mono", family: "IBM Plex Mono", description: "Editorial monospace — labels, data, terminal aesthetics.", weight: 600 },
];

export function lookupFont(name: string): FontDef | undefined {
  const n = name.trim().toLowerCase();
  return FONTS.find((f) => f.name.toLowerCase() === n);
}
