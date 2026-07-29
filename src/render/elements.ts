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
