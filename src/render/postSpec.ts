// Full-frame post FX. One object on the spec, applied over the finished composite.
//
// The order is FIXED, not authored: bloom must see graded colour, lens must distort the
// bloomed image, and grain must land last — anything after it would smear or warp the grain,
// which is exactly what makes digital grain look fake.
export const postChainOrder = ["grade", "bloom", "lens", "film"] as const;
export type PostStage = (typeof postChainOrder)[number];

export interface PostFx {
  /** White balance (`temperature` / `tint`) → three-way (`lift` / `gamma` / `gain`) → trim
   *  (`brightness` / `contrast` / `saturation`). Every stage is a no-op at its default, and the
   *  same params reach a per-beat `effects: [{ kind: "grade" }]` — one pass serves both. */
  grade?: {
    temperature?: number;
    tint?: number;
    lift?: number;
    gamma?: number;
    gain?: number;
    brightness?: number;
    contrast?: number;
    saturation?: number;
  };
  /** `halation` widens the bloom per channel — red furthest, blue least — which is what makes a
   *  highlight read as photographed rather than drawn. */
  bloom?: { threshold?: number; intensity?: number; radius?: number; halation?: number };
  lens?: { distortion?: number; chroma?: number };
  /** Vignette + grain. Defaults to theme.film when the stage is absent entirely. */
  /** `grain` scales the grain amount (1 = default); `grainHold` is how many frames a grain
   *  field persists — raise it for slower, calmer grain, drop it to 1 for per-frame movement. */
  film?: { intensity?: number; grain?: number; grainHold?: number; grainSize?: number };
}

// threshold of 0.45 cuts at roughly sRGB 0.70.
interface Range {
  min: number;
  max: number;
}
const RANGES: Record<PostStage, Record<string, Range>> = {
  // `gamma` bottoms out at 0.1, not 0: the pass raises to 1/gamma, and 1/0 has no meaning here.
  grade: {
    temperature: { min: -1, max: 1 },
    tint: { min: -1, max: 1 },
    lift: { min: -1, max: 1 },
    gamma: { min: 0.1, max: 4 },
    gain: { min: 0, max: 4 },
    brightness: { min: 0, max: 4 },
    contrast: { min: 0, max: 4 },
    saturation: { min: 0, max: 4 },
  },
  bloom: { threshold: { min: 0, max: 1 }, intensity: { min: 0, max: 4 }, radius: { min: 0, max: 128 }, halation: { min: 0, max: 1 } },
  lens: { distortion: { min: -1, max: 1 }, chroma: { min: 0, max: 0.05 } },
  film: { intensity: { min: 0, max: 1 }, grain: { min: 0, max: 4 }, grainHold: { min: 1, max: 8 }, grainSize: { min: 1, max: 8 } },
};

export function validatePostFx(p: unknown): string[] {
  if (p === undefined || p === null) return [];
  if (typeof p !== "object") return ["postFx must be an object"];
  const errs: string[] = [];
  for (const [stage, value] of Object.entries(p as Record<string, unknown>)) {
    if (!(postChainOrder as readonly string[]).includes(stage)) {
      errs.push(`postFx.${stage} is not a post stage — expected one of ${postChainOrder.join(", ")}`);
      continue;
    }
    if (typeof value !== "object" || value === null) {
      errs.push(`postFx.${stage} must be an object`);
      continue;
    }
    const ranges = RANGES[stage as PostStage];
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const range = ranges[k];
      if (!range) {
        errs.push(`postFx.${stage}.${k} is not a parameter — expected one of ${Object.keys(ranges).join(", ")}`);
      } else if (typeof v !== "number" || Number.isNaN(v)) {
        errs.push(`postFx.${stage}.${k} must be a number`);
      } else if (v < range.min || v > range.max) {
        errs.push(`postFx.${stage}.${k} must be between ${range.min} and ${range.max} (got ${v})`);
      }
    }
  }
  return errs;
}
