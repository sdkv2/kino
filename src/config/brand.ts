import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { CAPTION_STYLES, CAPTION_ANIMATIONS, CAPTION_REVEALS, type CaptionStyle, type CaptionAnimation } from "../render/textStyles.js";

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
    colors: z
      .object({
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
    bannedPhrases: z.array(z.string()).optional(),
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
  colors: { night: string; mint: string; green: string; white: string; gold: string };
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
  bannedPhrases: string[];
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
// THE PALETTE (canonical home). The five-slot brand colour set lives here; every other site that
// needs a palette colour reads it from a resolved Brand.colors (which is DEFAULT_BRAND.colors merged
// with any brand.md overrides) rather than redefining it. The slots and their roles:
//   night  — page/background base (the dark canvas everything sits on).
//   mint   — primary accent (light); highlights, kicker chips, default background tint.
//   green  — brand colour / active-word highlight (the brand name + the currently-spoken word).
//   white  — foreground text and the default caption ink.
//   gold   — secondary accent; reserved emphasis (--kino-gold), gold kicker chips.
// If you add or repurpose a slot, do it here and update Brand.colors + BrandFrontmatterSchema.colors.
export const DEFAULT_BRAND: Brand = {
  name: "",
  colors: { night: "#0b1020", mint: "#80e2b4", green: "#0c8d64", white: "#ffffff", gold: "#d99a20" },
  font: 'Helvetica, "Helvetica Neue", Arial, sans-serif',
  captionStyle: { fontSize: 74, strokeWidth: 9 },
  disclosure: "", // none unless a brand/spec sets it
  bannedPhrases: [],
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
    colors: { ...base.colors, ...(fm.colors ?? {}) },
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
