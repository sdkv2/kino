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

// --- Caption backplate ---------------------------------------------------------------------------
// A translucent rounded panel rendered behind the lower-third caption so white text stays legible
// over light app screenshots (where the stroke alone can wash out). Opt-in via brand
// captionStyle.background; absent → null → captions render exactly as before.

export interface CaptionBackgroundConfig {
  color?: string; // plate colour (default: brand night)
  opacity?: number; // 0..1 (default 0.82)
  appOnly?: boolean; // only behind captions on app cut-ins (default true)
}

export interface CaptionBackplate {
  bg: string; // resolved CSS colour with alpha baked in
  appOnly: boolean;
}

// Fold an opacity (0..1) into a hex colour as an alpha byte (#rrggbb → #rrggbbaa, #rgb expanded
// first). Non-hex colours pass through unchanged (best effort — brand palettes are hex).
export function withAlpha(color: string, opacity: number): string {
  const o = Math.max(0, Math.min(1, opacity));
  const a = Math.round(o * 255)
    .toString(16)
    .padStart(2, "0");
  const m3 = /^#([0-9a-fA-F]{3})$/.exec(color);
  if (m3) {
    const [r, g, b] = m3[1].split("");
    return `#${r}${r}${g}${g}${b}${b}${a}`;
  }
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return `${color}${a}`;
  return color;
}

export function resolveCaptionBackplate(cfg: CaptionBackgroundConfig | undefined, night: string): CaptionBackplate | null {
  if (!cfg) return null;
  return {
    bg: withAlpha(cfg.color ?? night, cfg.opacity ?? 0.82),
    appOnly: cfg.appOnly ?? true,
  };
}
