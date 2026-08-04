// Full-frame post FX. One object on the spec, applied over the finished composite.
//
// The order is FIXED, not authored: bloom must see graded colour, lens must distort the
// bloomed image, veiling glare is the last thing that happens inside the lens (so it lands on the
// distorted, bloomed frame and its measurement counts the light the lens actually gathered), grain
// lands after all of that — anything before it would smear or warp the grain, which is exactly what
// makes digital grain look fake — and the output dither lands last of all, on the finished 8-bit
// values it exists to break up.
export const postChainOrder = ["grade", "bloom", "lens", "veil", "film", "dither"] as const;
export type PostStage = (typeof postChainOrder)[number];

export interface PostFx {
  /** White balance (`temperature` / `tint`) → three-way (`lift` / `gamma` / `gain`) → trim
   *  (`brightness` / `contrast` / `saturation`), optionally keyed to a range of colours by the
   *  `key*` qualifier. Every stage is a no-op at its default, and the same params reach a per-beat
   *  `effects: [{ kind: "grade" }]` — one pass serves both. */
  grade?: {
    temperature?: number;
    tint?: number;
    lift?: number;
    gamma?: number;
    gain?: number;
    brightness?: number;
    contrast?: number;
    saturation?: number;
    /** Hue band A: centre in degrees (0 = red, 120 = green, 240 = blue) and half-width. A
     *  `keyRange` of 0 switches the band off — which is the default, so an unkeyed grade is
     *  global. */
    keyHue?: number;
    keyRange?: number;
    /** Hue band B, unioned with A — two bands because the protect case needs green AND red at
     *  once and one window cannot span them. */
    keyHue2?: number;
    keyRange2?: number;
    /** Minimum HSV saturation to qualify. On its own (no hue band) this keys every saturated
     *  colour and no neutral, which is how a design system's reserved colours are protected
     *  without naming one of them. */
    keySat?: number;
    /** Feather, as a fraction of each window's width. 0.35 is a soft secondary; near 0 is a hard
     *  edge (floored just above it — a truly hard key posterises gradients). */
    keySoft?: number;
    /** 1 = grade everything the key does NOT select. This is the protect switch. */
    keyInvert?: number;
  };
  /** `halation` widens the bloom per channel — red furthest, blue least — which is what makes a
   *  highlight read as photographed rather than drawn. */
  bloom?: { threshold?: number; intensity?: number; radius?: number; halation?: number };
  lens?: { distortion?: number; chroma?: number };
  /** Veiling glare — a flat black-lifting wash whose STRENGTH is measured from the frame, so it
   *  appears when something bright is in shot and recedes when it leaves. `amount` is the lift at
   *  full flux (a white frame); `threshold` is an ambient level below which the frame is taken to
   *  be too dark to scatter. */
  veil?: { amount?: number; threshold?: number };
  /** Vignette + grain. Defaults to theme.film when the stage is absent entirely.
   *
   *  `intensity` is the master. `grain` and `vignette` scale one half each (1 = default, 0 = off),
   *  so the two can be separated — a windowed adjustment layer wanting per-beat grain sets
   *  `vignette: 0`, and the piece-wide finish that carries the vignette sets `grain: 0`.
   *  `grainHold` is how many frames a grain field persists — raise it for slower, calmer grain,
   *  drop it to 1 for per-frame movement. `grainSize` is the clump size in output pixels. */
  film?: { intensity?: number; grain?: number; grainHold?: number; grainSize?: number; vignette?: number };
  /** Ordered (Bayer-8) output dither. Breaks the 8-bit plateaus in near-black gradients —
   *  measured 30–48px runs on a #000 → #0a0a10 ramp. `strength` 0..1 (default 0.5) is the
   *  dither's peak offset in LSBs; deterministic (pixel-position keyed), so identical frames
   *  stay identical. Absent = off, so no existing spec's pixels move. */
  dither?: { strength?: number };
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
    // The qualifier. `keyRange`/`keyRange2` are HALF-widths, so 180 is the whole wheel and there is
    // no value that means "more than everything"; `keyInvert` is a flag carried as a number because
    // every other post param is one and the validator only knows numbers.
    keyHue: { min: 0, max: 360 },
    keyRange: { min: 0, max: 180 },
    keyHue2: { min: 0, max: 360 },
    keyRange2: { min: 0, max: 180 },
    keySat: { min: 0, max: 1 },
    keySoft: { min: 0, max: 1 },
    keyInvert: { min: 0, max: 1 },
  },
  bloom: { threshold: { min: 0, max: 1 }, intensity: { min: 0, max: 4 }, radius: { min: 0, max: 128 }, halation: { min: 0, max: 1 } },
  lens: { distortion: { min: -1, max: 1 }, chroma: { min: 0, max: 0.05 } },
  // `amount` reaches 1 (the whole frame washed to white at full flux) rather than stopping at a
  // physically-plausible 0.05: this doubles as a dissolve-to-light on a bright beat, and a stage
  // that already measures the frame is the cheapest place to get one.
  veil: { amount: { min: 0, max: 1 }, threshold: { min: 0, max: 1 } },
  film: {
    intensity: { min: 0, max: 1 },
    grain: { min: 0, max: 4 },
    grainHold: { min: 1, max: 8 },
    grainSize: { min: 1, max: 8 },
    vignette: { min: 0, max: 4 },
  },
  dither: { strength: { min: 0, max: 1 } },
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
