import type { Brand } from "../config/brand.js";
import type { Spec } from "../spec/schema.js";

export type BackgroundKind = "glow" | "image" | "mesh" | "aurora" | "particles" | "grid" | "solid" | "custom";

// Faceless background selection. Spec overrides brand; unset → animated CSS glow.
// Brands that want a still backdrop set `background: "image"` + `facelessBackdrop` explicitly.
export function resolveBackgroundKind(brand: Brand, spec: Spec): BackgroundKind {
  return (spec.background ?? brand.background ?? "glow") as BackgroundKind;
}

export function resolveBackgroundColors(brand: Brand): string[] {
  return brand.backgroundColors ?? [brand.colors.mint, brand.colors.green, brand.colors.gold];
}

export function resolveBackgroundIntensity(brand: Brand, spec: Spec): number {
  return spec.backgroundIntensity ?? brand.backgroundIntensity ?? 0.5;
}
