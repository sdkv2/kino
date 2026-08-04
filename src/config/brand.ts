import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { CAPTION_STYLES, CAPTION_ANIMATIONS, CAPTION_REVEALS, type CaptionStyle, type CaptionAnimation } from "../render/textStyles.js";
import { PALETTE_PRESETS, declaresColors, normalizeColors, normalizeUiColors, type Palette, type UiRole } from "./palettes.js";

const Provider = z.enum(["none", "heygen", "hedra", "replicate"]);
const Background = z.enum(["glow", "image", "mesh", "aurora", "particles", "grid", "solid", "custom"]);
const CaptionStyleBg = z.object({ color: z.string().optional(), opacity: z.number().min(0).max(1).optional(), appOnly: z.boolean().optional() });

// THE BRAND SPLIT: BrandFrontmatter (below) and Brand (further down) look like duplicates but model
// two distinct states on purpose. BrandFrontmatter is the partial, every-field-optional on-disk
// shape parsed from a brand.md YAML frontmatter. Brand is the fully-populated, resolved shape the
// render pipeline consumes — produced by mergeBrand() layering the frontmatter over DEFAULT_BRAND.
// Keep the two in sync field-for-field, but do not collapse them: one is "what the author wrote",
// the other is "what every field is guaranteed to be after merge".

// Frontmatter: every field optional (defaults come from DEFAULT_BRAND). Types are still validated.
export const BrandFrontmatterSchema = z
  .object({
    name: z.string().optional(),
    // Optional, like everything else here — but with a consequence the other fields don't have:
    // omitting it leaves the brand with no declared palette, so every spec under it must set its
    // own `colors` (see assertColorScheme). A spec's `colors` overrides this block either way.
    colors: z
      .object({
        // Role keys (canonical since the palette-role rename); see config/palettes.ts.
        bg: z.string().optional(), // page/background base
        fg: z.string().optional(), // text ink
        accent: z.string().optional(), // primary accent
        accent2: z.string().optional(), // secondary/bright accent
        deep: z.string().optional(), // deep fill / active-word highlight
        // The UI roles (config/palettes.ts). Every one is derived from the five above when unset,
        // so declaring them is how a brand states its own fabricated-UI conventions rather than a
        // requirement. They are NOT part of any preset: a spec naming `noir` keeps them.
        surface: z.string().optional(), // a panel raised off the page
        line: z.string().optional(), // borders, dividers, rules
        muted: z.string().optional(), // secondary ink
        ok: z.string().optional(), // semantic: pass
        warn: z.string().optional(), // semantic: caution
        danger: z.string().optional(), // semantic: failure
        // Legacy literal-color names (the original house theme's hues) — accepted forever,
        // mapped onto the roles by normalizeColors; a role key wins over its alias.
        night: z.string().optional(),
        mint: z.string().optional(),
        green: z.string().optional(),
        white: z.string().optional(),
        gold: z.string().optional(),
      })
      .optional(),
    font: z.string().optional(),
    // Extra cuts of `font` to stage, so `font-weight` in a motion page selects a real face. Opt-in:
    // each cut's bytes are base64-inlined into every SVG raster, so staging four by default would
    // multiply that payload for projects that never ask. The caption cut is always included.
    fontWeights: z.array(z.number().int().min(100).max(900)).optional(),
    labelFont: z.string().optional(),
    captionStyle: z
      .object({
        fontSize: z.number().optional(),
        strokeWidth: z.number().optional(),
        background: CaptionStyleBg.optional(),
        style: z.enum(CAPTION_STYLES).optional(),
        animation: z.enum(CAPTION_ANIMATIONS).optional(),
        reveal: z.enum(CAPTION_REVEALS).optional(),
      })
      .optional(),
    disclosure: z.string().optional(), // AI disclosure shown on ordinary beats
    presenterDisclosure: z.string().optional(), // shown instead whenever a presenter is composited
    facelessDisclosure: z.string().optional(), // pre-1.22 name for `disclosure` (see normalizeDisclosures)
    backdrop: z.string().optional(), // still image behind `background: "image"`
    facelessBackdrop: z.string().optional(), // pre-1.22 name for `backdrop`
    background: Background.optional(),
    backgroundComponent: z.string().optional(),
    backgroundColors: z.array(z.string()).optional(),
    backgroundIntensity: z.number().optional(),
    captionMode: z.enum(["phrase", "words"]).optional(),
    defaultVoice: z.string().optional(),
    defaultLook: z.string().optional(),
    defaultProvider: Provider.optional(),
    avatarImage: z.string().optional(),
    hedraModelId: z.string().optional(),
    replicateModel: z.string().optional(),
    replicateImageField: z.string().optional(),
    replicateAudioField: z.string().optional(),
    replicateInput: z.record(z.unknown()).optional(),
    voiceAliases: z.record(z.string()).optional(),
    lookAliases: z.record(z.string()).optional(),
    film: z.number().min(0).max(1).optional(), // brand-level default cinematic-finish intensity (spec.film wins)
    voiceModel: z.string().optional(), // brand-level default TTS model (spec.voiceModel wins)
  })
  .strict();

export type BrandFrontmatter = z.infer<typeof BrandFrontmatterSchema>;

// The complete, resolved brand shape the render pipeline consumes (always fully populated after the
// merge over DEFAULT_BRAND — the resolved half of the brand split noted above).
export interface Brand {
  name: string;
  colors: Palette;
  /** The brand's UI-role overrides (config/palettes.ts). Separate from `colors` because every
   *  consumer of that field wants exactly five hexes, and because these do NOT participate in the
   *  "a preset replaces all five" rule — a spec naming a preset keeps its brand's border and state
   *  conventions. Empty when the brand states none, which is the common case. */
  uiColors: Partial<Record<UiRole, string>>;
  /**
   * Whether a brand.md actually declared `colors`, as opposed to inheriting the house palette by
   * omission. Provenance, not a colour — it sits here rather than inside `colors` because every
   * consumer of `colors` wants five hexes. `assertColorScheme` is the only reader: without this bit
   * a colourless brand.md is indistinguishable downstream from a real palette choice, which is the
   * silent fall-through spec-level colours exist to close.
   */
  colorsDeclared: boolean;
  font: string;
  fontWeights?: number[];
  labelFont?: string;
  captionStyle: {
    fontSize: number;
    strokeWidth: number;
    background?: z.infer<typeof CaptionStyleBg>;
    style?: CaptionStyle;
    animation?: CaptionAnimation;
  };
  disclosure: string;
  presenterDisclosure?: string;
  backdrop?: string;
  background?: z.infer<typeof Background>;
  backgroundComponent?: string;
  backgroundColors?: string[];
  backgroundIntensity?: number;
  captionMode?: "phrase" | "words";
  defaultVoice?: string;
  defaultLook?: string;
  defaultProvider?: z.infer<typeof Provider>;
  avatarImage?: string;
  hedraModelId?: string;
  replicateModel?: string;
  replicateImageField?: string;
  replicateAudioField?: string;
  replicateInput?: Record<string, unknown>;
  voiceAliases: Record<string, string>;
  lookAliases: Record<string, string>;
  film?: number;
  voiceModel?: string;
}

// kino house defaults — used when no brand is set and to fill any field a brand.md omits.
//
// The palette itself lives in config/palettes.ts (roles, presets, aliases, resolver); the house set
// is the `midnight` preset. `colorsDeclared: false` is the point of the flag: these colours are a
// floor for unset roles, never a scheme anyone chose, so they don't satisfy the requirement that a
// build declare one.
export const DEFAULT_BRAND: Brand = {
  name: "",
  colors: { ...PALETTE_PRESETS.midnight },
  uiColors: {},
  colorsDeclared: false,
  font: 'Helvetica, "Helvetica Neue", Arial, sans-serif',
  captionStyle: { fontSize: 74, strokeWidth: 9 },
  disclosure: "", // none unless a brand/spec sets it
  voiceAliases: {},
  lookAliases: {},
};

// Split a brand.md into its YAML frontmatter (object) + the markdown body (guidelines).
export function parseBrandMd(text: string): { frontmatter: Record<string, unknown>; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!m) return { frontmatter: {}, body: text };
  const fm = (parseYaml(m[1]) ?? {}) as Record<string, unknown>;
  return { frontmatter: fm, body: m[2] };
}

/**
 * Pre-1.22 brands named these fields around the presenter being the default:
 * `disclosure` was the WITH-presenter text and `facelessDisclosure` the one for every other beat.
 * Presenters are the exception now, so `disclosure` is the ordinary text and `presenterDisclosure`
 * overrides it on camera. Behaviour is preserved exactly, including the old fallback where a brand
 * that set only `disclosure` showed it in both cases — an AI disclosure must never silently drop.
 */
function normalizeDisclosures(fm: BrandFrontmatter): BrandFrontmatter {
  const out = { ...fm };
  if (out.facelessBackdrop && !out.backdrop) out.backdrop = out.facelessBackdrop;
  delete out.facelessBackdrop;
  if (!out.facelessDisclosure) return out;
  if (!out.presenterDisclosure) out.presenterDisclosure = out.disclosure; // old `disclosure` = on camera
  out.disclosure = out.facelessDisclosure;
  delete out.facelessDisclosure;
  return out;
}

function mergeBrand(base: Brand, fmRaw: BrandFrontmatter): Brand {
  const fm = normalizeDisclosures(fmRaw);
  return {
    ...base,
    ...fm,
    colors: { ...base.colors, ...normalizeColors(fm.colors ?? {}) },
    uiColors: { ...base.uiColors, ...normalizeUiColors(fm.colors ?? {}) },
    // Sticky: a brand that declares colours keeps that provenance even where it leaves roles unset.
    colorsDeclared: base.colorsDeclared || declaresColors(fm.colors),
    captionStyle: { ...base.captionStyle, ...(fm.captionStyle ?? {}) },
  } as Brand;
}

// Read brands/<name>/brand.md → resolved Brand (frontmatter merged over DEFAULT_BRAND).
export function loadBrand(brandDir: string): Brand {
  return loadBrandDoc(brandDir).brand;
}

const brandCache = new Map<string, { brand: Brand; body: string }>();

// Like loadBrand, but also returns the markdown guidelines body (for `kino brand`).
export function loadBrandDoc(brandDir: string): { brand: Brand; body: string } {
  if (brandCache.has(brandDir)) return brandCache.get(brandDir)!;
  const mdPath = join(brandDir, "brand.md");
  if (!existsSync(mdPath)) throw new Error(`Brand not found: ${mdPath} — create brands/<name>/brand.md`);
  const { frontmatter, body } = parseBrandMd(readFileSync(mdPath, "utf8"));
  const fm = BrandFrontmatterSchema.parse(frontmatter);
  const res = { brand: mergeBrand(DEFAULT_BRAND, fm), body };
  brandCache.set(brandDir, res);
  return res;
}
