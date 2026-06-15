// Which engine turns the voiceover into a talking-head clip.
//   none     — faceless: no avatar at all (free; app footage + VO + captions)
//   heygen   — HeyGen Avatar-IV hosted look (premium, highest quality)
//   hedra    — Hedra Character-3 (cheap API, free monthly tier; needs a portrait image)
//   replicate — open-source lip-sync model on Replicate (pennies/clip; needs a portrait image)
export type Provider = "none" | "heygen" | "hedra" | "replicate";

export const PROVIDERS: readonly Provider[] = ["none", "heygen", "hedra", "replicate"];

// Providers that synthesise from a source portrait image (vs. a hosted avatar id).
export function needsSourceImage(p: Provider): boolean {
  return p === "hedra" || p === "replicate";
}
