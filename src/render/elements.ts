// Logo (and future overlay element) layout resolvers — sizes + positions, with custom escape hatches.
// Positions are percentages of the frame; the element is anchored at its centre on (x, y).
export const LOGO_SIZES: Record<string, number> = { small: 100, medium: 150, big: 220 };

export const LOGO_POSITIONS: Record<string, { x: number; y: number }> = {
  top: { x: 50, y: 8 },
  bottom: { x: 50, y: 88 },
  left: { x: 12, y: 50 },
  right: { x: 88, y: 50 },
  center: { x: 50, y: 50 },
};

export function resolveLogoSize(v?: string | number): number {
  if (typeof v === "number") return v;
  return LOGO_SIZES[v ?? "medium"] ?? LOGO_SIZES.medium;
}

export function resolveLogoPosition(v?: string | { x: number; y: number }): { x: number; y: number } {
  if (v && typeof v === "object") return v;
  return LOGO_POSITIONS[v ?? "top"] ?? LOGO_POSITIONS.top;
}
