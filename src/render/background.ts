import type { Brand } from "../config/brand.js";
import type { Spec } from "../spec/schema.js";

export type BackgroundKind = "glow" | "image" | "mesh" | "aurora" | "particles" | "grid" | "custom";

// Faceless background selection. Back-compat: a brand with only a facelessBackdrop image keeps
// rendering that image; with nothing set, the animated CSS glow. Spec overrides brand.
export function resolveBackgroundKind(brand: Brand, spec: Spec): BackgroundKind {
  return (spec.background ?? brand.background ?? (brand.facelessBackdrop ? "image" : "glow")) as BackgroundKind;
}

export function resolveBackgroundColors(brand: Brand): string[] {
  return brand.backgroundColors ?? [brand.colors.mint, brand.colors.green, brand.colors.gold];
}

export function resolveBackgroundIntensity(brand: Brand, spec: Spec): number {
  return spec.backgroundIntensity ?? brand.backgroundIntensity ?? 0.5;
}
