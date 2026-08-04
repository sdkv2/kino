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
import { contrastRatio, relativeLuminance } from "../render/contrast.js";

export const PALETTE_ROLES = ["bg", "fg", "accent", "accent2", "deep"] as const;
export type PaletteRole = (typeof PALETTE_ROLES)[number];
export type Palette = Record<PaletteRole, string>;

// --- THE UI ROLES -------------------------------------------------------------------------------
//
// The five above are caption-sized. They are the right five for painting words over a background,
// which is what they were designed for — and they run out the moment a motion graphic fabricates a
// product surface, because a spoof UI is not a caption. It is a hierarchy of surfaces, a hierarchy
// of ink, and a grammar of states, and none of those three is expressible in "bg, fg, and three
// accents". Past five an author hard-codes hexes into the HTML, and at that point the brand has
// stopped driving the look — which is the actual failure, not the missing colours.
//
// Six more, chosen by asking what a fabricated interface CANNOT be drawn without:
//
//   surface — a panel raised off the page. Every card, sidebar, terminal chrome and modal needs a
//             plane that is not `bg`, or it has no edges at all.
//   line    — borders, dividers, table rules, the 1px that makes a UI read as built rather than
//             typeset.
//   muted   — secondary ink: labels, timestamps, inactive rows, units, placeholder text. The most
//             frequently hard-coded colour in the corpus, by a distance.
//   ok / warn / danger — the SEMANTIC triad, and the reason this list is not just "more accents".
//             A design system's reserved colours mean something: green passes, red fails, amber is
//             a warning. `accent` and `deep` are stylistic and move with the brand; overloading
//             them with state is exactly what makes a fabricated UI stop being legible when the
//             brand changes. These three are allowed to be brand-independent for that reason.
//
// Everything past that (a fourth state colour, a purple "merged", per-surface elevation) is a
// design system's own vocabulary, and the place to express it is `spec.data` — a spec-level
// constant is exactly the right shape for "this piece happens to also need purple".
export const UI_ROLES = ["surface", "line", "muted", "ok", "warn", "danger"] as const;
export type UiRole = (typeof UI_ROLES)[number];
/** The five core roles plus the six UI ones, all present. What a render actually paints from. */
export type FullPalette = Palette & Record<UiRole, string>;

/** Mix two hex colours in sRGB. Crude on purpose: these are UI plates and rules, where a
 *  perceptual blend would buy nothing an author can see and would drag a colour library into a
 *  module whose whole point is having no dependencies.
 *
 *  Unparseable input — INCLUDING a missing value entirely — reads as black rather than throwing,
 *  the same policy contrast.ts's `channels` states and for the same reason: a KinoProps built by
 *  hand carries a partial theme, and a derived border colour is not worth taking a whole render
 *  down over. */
function mix(a: string, b: string, t: number): string {
  const ch = (hex: string): [number, number, number] => {
    if (typeof hex !== "string") return [0, 0, 0];
    const h = hex.trim().replace(/^#/, "");
    const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    if (!/^[0-9a-fA-F]{6}$/.test(full)) return [0, 0, 0];
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
  };
  const [ar, ag, ab] = ch(a);
  const [br, bg, bb] = ch(b);
  const c = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, "0");
  return `#${c(ar, br)}${c(ag, bg)}${c(ab, bb)}`;
}

/** How far each derived plate/ink sits between its two anchors. */
const SURFACE_MIX = 0.07; // a panel just off the page — visible as an edge, not as a second colour
const LINE_MIX = 0.18;   // a rule that reads at 1px without becoming a highlight
const MUTED_MIX = 0.38;  // secondary ink: clearly quieter, still comfortably readable

/**
 * The stock semantic triad, for a palette that does not name one.
 *
 * Deliberately NOT derived from the five roles: a state colour that shifts with the brand stops
 * meaning "this build failed". These are the hues a viewer already reads as pass / caution / fail,
 * and a brand that wants its own says so.
 */
const STOCK_SEMANTICS = { ok: "#22c55e", warn: "#f59e0b", danger: "#ef4444" } as const;

/** Contrast a state colour has to clear against the page before it counts as readable. 3:1 is the
 *  WCAG floor for large text and UI components, which is what these paint. */
const SEMANTIC_FLOOR = 3;

/**
 * Hold a stock semantic's HUE while making it survive the palette it landed on.
 *
 * The triad is tuned for a dark page, and on `paper` (or any light custom scheme) an amber warning
 * lands at roughly 1.8:1 — a colour the viewer can see is there and cannot read. Darkening toward
 * black on a light page and lightening toward white on a dark one keeps the hue, which is the part
 * carrying the meaning, and moves only the lightness, which is the part carrying the legibility.
 *
 * A no-op on every dark palette, including the house one: all three already clear the floor there,
 * so this changes no existing render.
 */
function legibleOn(colour: string, bg: string): string {
  const toward = relativeLuminance(bg) > 0.5 ? "#000000" : "#ffffff";
  for (let t = 0; t <= 0.6; t += 0.05) {
    const out = mix(colour, toward, t);
    if (contrastRatio(out, bg) >= SEMANTIC_FLOOR) return out;
  }
  return mix(colour, toward, 0.6);
}

/**
 * Fill the six UI roles from the five core ones, honouring anything explicitly set.
 *
 * Derivation rather than obligation is the whole design: every brand, preset and spec that exists
 * declares five colours, and making six more REQUIRED would break all of them at once for a feature
 * most pieces never touch. So the defaults are computed, and each is a colour the author would
 * otherwise have hard-coded to roughly the same value.
 *
 * The surface/line/muted rules run toward `fg` and toward `bg` respectively, so they invert
 * correctly on a light scheme without a branch: on a dark base a panel is lighter and secondary ink
 * is dimmer; on `paper` a panel is a shade darker than the page (which is what light design systems
 * actually do) and secondary ink is greyer.
 */
export function derivePalette(core: Palette, set: Partial<Record<UiRole, string>> = {}): FullPalette {
  return {
    ...core,
    surface: set.surface ?? mix(core.bg, core.fg, SURFACE_MIX),
    line: set.line ?? mix(core.bg, core.fg, LINE_MIX),
    muted: set.muted ?? mix(core.fg, core.bg, MUTED_MIX),
    ok: set.ok ?? legibleOn(STOCK_SEMANTICS.ok, core.bg),
    warn: set.warn ?? legibleOn(STOCK_SEMANTICS.warn, core.bg),
    danger: set.danger ?? legibleOn(STOCK_SEMANTICS.danger, core.bg),
  };
}

/** Map a colours block's UI keys onto roles, dropping anything unset. Mirrors normalizeColors;
 *  the UI roles have no legacy aliases, so it is a straight pick. */
export function normalizeUiColors(colors: Partial<Record<UiRole, string>>): Partial<Record<UiRole, string>> {
  const out: Partial<Record<UiRole, string>> = {};
  for (const role of UI_ROLES) if (colors[role] != null) out[role] = colors[role];
  return out;
}


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

/** A spec's `colors`: a preset name, or a block that may name a preset to start from. The UI roles
 *  ride the same block; they are not part of any preset (see resolveFullPalette). */
export type SpecColorsInput =
  | PalettePreset
  | (ColorsInput & Partial<Record<UiRole, string>> & { preset?: PalettePreset });

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
