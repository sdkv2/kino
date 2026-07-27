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
