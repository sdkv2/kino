// Canvas2D ports of the three CSS-only backdrop behaviors in components.tsx. The compositor
// has no CSS in its pixel path, so GlowBg, Scrim and ImageBg's Ken-Burns have to exist as
// draw functions. Geometry and colors are copied from the CSS so parity holds.
import type { DrawFn } from "./presets.js";
import { interpolate } from "../interpolate.js";

/** ImageBg's slow push-in: 1.05 → 1.13 over 300 frames, clamped. */
export function kenBurnsScale(frame: number): number {
  return interpolate(frame, [0, 300], [1.05, 1.13], { extrapolateRight: "clamp" });
}

/** Alpha suffix helper — the CSS writes brand colors with 2-hex-digit alpha. */
const withAlpha = (hex: string, alpha: string) => `${hex}${alpha}`;

/**
 * GlowBg: a 160° graded base plus three blurred brand glows drifting on the frame clock.
 * Blur radii come from the CSS `filter: blur(...)` values; ctx.filter is set and reset around
 * each glow so no blur leaks into the next draw.
 */
export const glowDraw: DrawFn = (ctx, e) => {
  const { width: w, height: h, frame: f } = e;
  const night = String(e.params.night ?? "#0b1020");
  const green = String(e.params.green ?? "#0c8d64");
  const mint = String(e.params.mint ?? "#80e2b4");
  const gold = String(e.params.gold ?? "#d99a20");

  // 160° linear base: night → green at 1e alpha → night.
  const rad = (160 * Math.PI) / 180;
  const base = ctx.createLinearGradient(0, 0, Math.cos(rad) * w, Math.sin(rad) * h);
  base.addColorStop(0, night);
  base.addColorStop(0.55, withAlpha(green, "1e"));
  base.addColorStop(1, night);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);

  const dx = Math.sin(f / 60) * 6;
  const dy = Math.cos(f / 80) * 8;
  const dx2 = Math.cos(f / 52) * 5;

  const glow = (cx: number, cy: number, size: number, color: string, alpha: string, blur: number, stop: number) => {
    ctx.save();
    ctx.filter = `blur(${blur}px)`;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, size / 2);
    g.addColorStop(0, withAlpha(color, alpha));
    g.addColorStop(stop, withAlpha(color, "00"));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  // Positions mirror the CSS: top/left, bottom/right, and a mid-right accent.
  glow(((10 + dx) / 100) * w + 490, ((16 + dy) / 100) * h + 490, 980, green, "66", 44, 0.62);
  glow(w - ((6 + dx) / 100) * w - 410, h - ((6 - dy) / 100) * h - 410, 820, mint, "3d", 52, 0.62);
  glow(((58 + dx2) / 100) * w + 280, ((52 + dy) / 100) * h + 280, 560, gold, "24", 58, 0.64);
};

/**
 * Scrim: the legibility gradient over canvas and image backdrops. Shader backdrops must NOT
 * get it — the frag owns exposure, and liquid glass samples the raw canvas, so a scrim would
 * darken the scene while the glass stayed bright.
 */
export const scrimDraw: DrawFn = (ctx, e) => {
  const { width: w, height: h } = e;
  const night = String(e.params.night ?? "#0b1020");
  const light = Number(e.params.nightLuminance ?? 0) > 0.5;
  const a0 = light ? "33" : "9c";
  const a1 = light ? "14" : "2e";
  const g = ctx.createRadialGradient(w * 0.5, h * 0.48, 0, w * 0.5, h * 0.48, Math.max(w * 0.76, h * 0.5));
  g.addColorStop(0, withAlpha(night, a0));
  g.addColorStop(0.66, withAlpha(night, a1));
  g.addColorStop(1, withAlpha(night, "00"));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
};
