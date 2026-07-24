// Presenter video sources. A beat asks for a presenter with `source: "avatar:"` (whatever
// provider the spec/brand/project configures) or by pinning one: "heygen:", "hedra:",
// "replicate:". Anything after the colon is a look — a HeyGen look alias/id, or a portrait
// image path for hedra/replicate — and overrides `avatarLook` for the build.
//
// kino generates ONE presenter clip per build (trimmed to the on-camera runs, see plan.ts), so
// pins have to agree across beats. Disagreements are an authoring error, not a silent pick.
import { isPresenterSource } from "../spec/schema.js";
import type { Spec } from "../spec/schema.js";

export type PresenterProvider = "heygen" | "hedra" | "replicate";

export interface PresenterSource {
  /** Pinned provider, or null when the beat said "avatar:" and takes the configured one. */
  provider: PresenterProvider | null;
  /** Look after the colon (HeyGen look id, or a portrait path), or null for the configured one. */
  look: string | null;
}

export function parsePresenterSource(source: string): PresenterSource {
  const [scheme, ...rest] = source.split(":");
  const look = rest.join(":").trim();
  return {
    provider: scheme === "avatar" ? null : (scheme as PresenterProvider),
    look: look || null,
  };
}

/** Which beats are on camera. Index-aligned with spec.segments. */
export function presenterBeats(spec: Spec): boolean[] {
  return spec.segments.map((s) => s.kind === "scene" && isPresenterSource(s.source));
}

/**
 * The provider and look the presenter beats ask for, or null when no beat wants one.
 * Throws when beats disagree — one clip per build means one provider and one look.
 */
export function resolvePresenterPin(spec: Spec): PresenterSource | null {
  const pins = spec.segments
    .map((s, i) => ({ i, source: s.kind === "scene" ? s.source : undefined }))
    .filter((e): e is { i: number; source: string } => isPresenterSource(e.source))
    .map((e) => ({ i: e.i, ...parsePresenterSource(e.source) }));
  if (pins.length === 0) return null;

  const disagree = (key: "provider" | "look"): string | null => {
    const set = [...new Set(pins.map((p) => p[key]).filter((v) => v != null))] as string[];
    if (set.length > 1) {
      throw new Error(
        `Segments pin different presenter ${key}s (${set.join(", ")}). kino generates one presenter clip per build, so every presenter beat must agree.`,
      );
    }
    return set[0] ?? null;
  };
  return { provider: disagree("provider") as PresenterProvider | null, look: disagree("look") };
}
