// Tier-3 Lottie support: parse + validate + lint + playback math for embedded Bodymovin (.json)
// animations. fs-free and pure (deterministic) so it runs node-side (resolveMotionGraphic) AND in the
// Remotion bundle (MotionGraphic.tsx). See docs/superpowers/specs/2026-06-19-lottie-tier3-design.md.

export type LottieData = Record<string, unknown>;

export const LOTTIE_MAX_BYTES = 3 * 1024 * 1024; // 3 MB; the JSON ships inline in Remotion inputProps

// Parse a Lottie JSON string and validate it is a Bodymovin doc with a determinable duration.
// Throws friendly errors (caught by resolveMotionGraphic and surfaced to the agent).
export function parseLottie(raw: string): { data: LottieData } {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("not valid JSON");
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("not a Lottie animation (expected a JSON object)");
  }
  const d = data as Record<string, unknown>;
  const ok =
    typeof d.v === "string" &&
    typeof d.w === "number" &&
    typeof d.h === "number" &&
    typeof d.fr === "number" &&
    typeof d.ip === "number" &&
    typeof d.op === "number" &&
    Array.isArray(d.layers);
  if (!ok) {
    throw new Error("not a Lottie animation (expected Bodymovin JSON with v/w/h/fr/ip/op/layers)");
  }
  if (!((d.op as number) > (d.ip as number)) || !((d.fr as number) > 0)) {
    throw new Error("Lottie has no determinable duration (op must exceed ip, fr must be > 0)");
  }
  return { data: d };
}
