// Output canvas sizes. Aspect ids (`9:16`) are 1080-class; `*-4k` are UHD (4× pixels).
// File tags use `:` → `x` so `9:16-4k` → `9x16-4k.mp4`.

export const FORMATS = ["9:16", "3:4", "16:9", "9:16-4k", "3:4-4k", "16:9-4k"] as const;
export type FormatId = (typeof FORMATS)[number];

export const FORMAT_DIMS: Record<FormatId, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "3:4": { width: 1080, height: 1440 },
  "16:9": { width: 1920, height: 1080 },
  "9:16-4k": { width: 2160, height: 3840 },
  "3:4-4k": { width: 2160, height: 2880 },
  "16:9-4k": { width: 3840, height: 2160 },
};

export function isFormatId(s: string): s is FormatId {
  return (FORMATS as readonly string[]).includes(s);
}

export function formatDims(fmt: FormatId): { width: number; height: number } {
  return FORMAT_DIMS[fmt];
}

/** Longest edge across requested formats — drives footage extract budget. */
export function maxOutputDim(formats: FormatId[]): number {
  return Math.max(...formats.map((f) => Math.max(FORMAT_DIMS[f].width, FORMAT_DIMS[f].height)));
}

export function formatFileTag(fmt: FormatId): string {
  return fmt.replace(/:/g, "x");
}

/** The 1080-class twin a `*-4k` format is authored in. Identity for 1080-class ids. */
export function baseFormat(fmt: FormatId): FormatId {
  return (fmt.endsWith("-4k") ? fmt.slice(0, -3) : fmt) as FormatId;
}

/**
 * Composition canvas — the space specs are authored in. Always the 1080-class dims: captions,
 * CAPTION_BOTTOM, absolute-px motion graphics are all written against it, so a `*-4k` render
 * composes here too and gains its pixels as an output scale (same frame, 4× the pixels), the
 * same comp/out split a draft uses in the other direction.
 */
export function compDims(fmt: FormatId): { width: number; height: number } {
  return FORMAT_DIMS[baseFormat(fmt)];
}

/** Draft output: short edge in px. 720p — 16:9 → 1280x720, 9:16 → 720x1280. */
export const DRAFT_SHORT_EDGE = 720;

/**
 * A format's canvas scaled so its SHORT edge is `shortEdge` px, aspect kept, never upscaled.
 *
 * This is an OUTPUT size, not a composition size: everything on screen is authored in the
 * format's own pixels (74px captions, `top: 480px` in a motion graphic), so a draft lays out at
 * FORMAT_DIMS and rasterises that composition onto this smaller surface. Same frame, fewer
 * pixels — not a smaller frame. Both edges are rounded to even so yuv420p can encode them.
 */
export function scaledDims(fmt: FormatId, shortEdge: number): { width: number; height: number } {
  const { width, height } = FORMAT_DIMS[fmt];
  const s = shortEdge / Math.min(width, height);
  if (s >= 1) return { width, height };
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return { width: even(width * s), height: even(height * s) };
}

export function parseFormatList(csv: string): FormatId[] {
  const out = csv.split(",").map((s) => s.trim()).filter(Boolean);
  for (const f of out) {
    if (!isFormatId(f)) {
      throw new Error(`unknown format "${f}" — expected ${FORMATS.join(" | ")}`);
    }
  }
  if (!out.length) throw new Error("empty --format list");
  return out as FormatId[];
}
