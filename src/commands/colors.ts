import { PALETTE_PRESETS, PALETTE_ROLES, type Palette, type PalettePreset } from "../config/palettes.js";
import { isLightSurface, readableInk } from "../render/contrast.js";

// What each role does on screen, printed alongside the presets so an author picking hexes knows
// which slot carries which job.
const ROLE_NOTES: Record<string, string> = {
  bg: "page/background base",
  fg: "text ink, default caption colour",
  accent: "primary accent — highlights, kicker chips, background tint",
  accent2: "secondary/bright accent — reserved emphasis",
  deep: "deep fill / active-word highlight",
};

/** A truecolor swatch: the hex painted on itself, in ink derived the same way a kicker chip is. */
function swatch(hex: string, palette: Palette): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const ink = readableInk(hex, palette.fg, palette.bg);
  const [ir, ig, ib] = [1, 3, 5].map((i) => parseInt(ink.slice(i, i + 2), 16));
  return `\x1b[48;2;${r};${g};${b}m\x1b[38;2;${ir};${ig};${ib}m ${hex} \x1b[0m`;
}

// Discovery: the stock colour schemes and the two ways a spec sets one. Mirrors `kino backgrounds`
// / `kino transitions`.
export async function colors(): Promise<void> {
  const w = process.stdout.write.bind(process.stdout);
  w("Colour schemes — declare one on the spec or on a brand. Unset falls back to kino's own\n");
  w('"midnight" palette, with a validate warning.\n\n');

  w("  Roles:\n");
  for (const role of PALETTE_ROLES) w(`    ${role.padEnd(9)} ${ROLE_NOTES[role]}\n`);
  w("    (the pre-rename names night/white/mint/gold/green still work as aliases)\n\n");

  w("  Presets:\n");
  for (const [name, palette] of Object.entries(PALETTE_PRESETS) as [PalettePreset, Palette][]) {
    w(`    ${name}${isLightSurface(palette.bg) ? '   (light — pair with "film": 0)' : ""}\n      `);
    for (const role of PALETTE_ROLES) w(`${swatch(palette[role], palette)} `);
    w(`\n      ${PALETTE_ROLES.map((r) => `${r}:${palette[r]}`).join("  ")}\n\n`);
  }

  w("  In a spec:\n");
  w('    "colors": "noir"                                   // a preset, all five roles\n');
  w('    "colors": { "bg": "#0a0a0c", "accent": "#e6b34a" } // roles (unset ones keep the brand/house value)\n');
  w('    "colors": { "preset": "noir", "accent": "#ff0055" }// a preset, one role deviating\n\n');
  w("  A brand.md `colors:` block does the same for every spec in a project — reach for one when\n");
  w("  you also want shared tone/voice guidelines, fonts, disclosures, or voice aliases.\n");
}
