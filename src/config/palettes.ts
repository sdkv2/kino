// THE PALETTE. The five colour roles every kino render draws from, the named stock schemes, and the
// resolver that layers a spec's `colors` over a brand's. Dependency-free on purpose: config/brand.ts
// and spec/schema.ts both import from here, so importing either one back would be a cycle.
//
// The roles (named by what a slot DOES — the pre-rename literal names in LEGACY_COLOR_ALIASES below
// are the original house theme's hues, still accepted everywhere and still emitted as CSS-var
// aliases by render/motionVars.ts):
//   bg      — page/background base (the canvas everything sits on).           [was: night]
//   accent  — primary accent; highlights, kicker chips, background tint.      [was: mint]
//   deep    — deep fill / active-word highlight (brand name + spoken word).   [was: green]
//   fg      — foreground text and the default caption ink.                    [was: white]
//   accent2 — secondary/bright accent; reserved emphasis, kicker chips.       [was: gold]
// If you add or repurpose a role, do it here and update Brand.colors, BrandFrontmatterSchema.colors,
// SpecColors in spec/schema.ts, and the alias emission in render/motionVars.ts.

export const PALETTE_ROLES = ["bg", "fg", "accent", "accent2", "deep"] as const;
export type PaletteRole = (typeof PALETTE_ROLES)[number];
export type Palette = Record<PaletteRole, string>;

/**
 * Stock colour schemes, nameable from a spec (`"colors": "noir"`) so an author gets a coherent set
 * without inventing five hexes. `midnight` IS the historic kino house palette — keeping it named
 * means the default look stays reachable now that an unset palette is an error.
 */
export const PALETTE_PRESETS = {
  // The house palette: dark navy base, mint accent, deep green fill, gold secondary.
  midnight: { bg: "#0b1020", fg: "#ffffff", accent: "#80e2b4", accent2: "#d99a20", deep: "#0c8d64" },
  // Editorial/luxury: near-black base, warm amber accent, cream secondary, rust fill.
  noir: { bg: "#0c0c0e", fg: "#f4f0e6", accent: "#e0a83c", accent2: "#f2dfb4", deep: "#a85a1e" },
  // The light one: warm paper base, near-black ink, saturated blue accent, warm red secondary.
  // Pair with "film": 0 — the cinematic vignette reads as a dirty border on a light base.
  paper: { bg: "#f4f1ea", fg: "#16130f", accent: "#1d4ed8", accent2: "#d9463b", deep: "#0f2a7a" },
} as const satisfies Record<string, Palette>;

export type PalettePreset = keyof typeof PALETTE_PRESETS;
export const PALETTE_PRESET_NAMES = Object.keys(PALETTE_PRESETS) as [PalettePreset, ...PalettePreset[]];

/**
 * Pre-rename literal colour names → roles. Accepted forever in both brand.md and spec `colors`, so
 * a half-migrated brand and a spec written against the old docs both keep working. A role key wins
 * over its own alias (mirroring the facelessDisclosure pattern) so a file carrying both is
 * predictable rather than order-dependent.
 */
export const LEGACY_COLOR_ALIASES = { night: "bg", white: "fg", mint: "accent", gold: "accent2", green: "deep" } as const;
export type LegacyColorName = keyof typeof LEGACY_COLOR_ALIASES;

/** The on-disk colours block, in either vocabulary — every key optional. */
export type ColorsInput = Partial<Record<PaletteRole | LegacyColorName, string>>;

/** Map a colours block (role keys and/or legacy names) onto roles, dropping anything unset. */
export function normalizeColors(colors: ColorsInput): Partial<Palette> {
  const out: Partial<Palette> = {};
  for (const [legacy, role] of Object.entries(LEGACY_COLOR_ALIASES) as [LegacyColorName, PaletteRole][]) {
    const v = colors[role] ?? colors[legacy];
    if (v != null) out[role] = v;
  }
  return out;
}

/** True when a colours block actually declares something (vs being absent or `{}`). */
export function declaresColors(colors: ColorsInput | undefined): boolean {
  return !!colors && Object.keys(normalizeColors(colors)).length > 0;
}

/** A spec's `colors`: a preset name, or a block that may name a preset to start from. */
export type SpecColorsInput = PalettePreset | (ColorsInput & { preset?: PalettePreset });

/**
 * Resolve the palette a build renders with.
 *
 * Layering, weakest first: the brand's colours (themselves already merged over the house palette) <
 * a preset the spec names < the spec's own role keys.
 *
 * Naming a preset REPLACES all five roles rather than merging over the brand — `"noir"` under a
 * brand whose accent is mint should be noir, not a hybrid nobody chose. Per-role keys in the same
 * block are how you deviate from a preset on purpose.
 */
export function resolvePalette(specColors: SpecColorsInput | undefined, brandColors: Palette): Palette {
  if (specColors == null) return brandColors;
  if (typeof specColors === "string") return { ...PALETTE_PRESETS[specColors] };
  const { preset, ...roles } = specColors;
  const base = preset ? PALETTE_PRESETS[preset] : brandColors;
  return { ...base, ...normalizeColors(roles) };
}
