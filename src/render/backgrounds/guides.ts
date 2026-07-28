// Canvas2D ports of the QA overlays that used to live in PlatformGuide.tsx. The compositor has
// no CSS in its pixel path, so the safe-zone chrome and the rule-of-thirds grid have to exist as
// draw functions — same reason glow.ts exists. Geometry and colors are copied from the CSS so
// parity holds with the stills these were originally read against.
//
// Both are still/storyboard only. `kino build` never sets props.grid or props.platformGuide.
import type { DrawFn } from "./presets.js";
import type { PlatformGuideKind } from "../platform.js";

const GUIDE: Record<PlatformGuideKind, { rail: number; bottom: number; top: number; label: string }> = {
  // Rough in-feed chrome — right icon rail, bottom caption/username, top status.
  tiktok: { rail: 0.12, bottom: 0.18, top: 0.08, label: "TikTok safe zones" },
  reels: { rail: 0.11, bottom: 0.16, top: 0.07, label: "Reels / Shorts safe zones" },
};

/**
 * Rule-of-thirds grid for still composition QA (`kino still --grid`).
 *
 * The CSS drew 1px hairlines at composition scale. Here the line weight is derived from the
 * canvas width instead, so an SS=2 still gets a 2px line rather than a line that halves in
 * apparent thickness — these are read by eye, and a vanishing hairline defeats the purpose.
 */
export const gridDraw: DrawFn = (ctx, e) => {
  const { width: w, height: h } = e;
  const weight = Math.max(1, Math.round(w / 1080));
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  for (const i of [1, 2]) {
    ctx.fillRect(Math.round((i * w) / 3), 0, weight, h);
    ctx.fillRect(0, Math.round((i * h) / 3), w, weight);
  }
};

/**
 * Translucent in-feed chrome overlay for still/storyboard QA (`--platform tiktok|reels`).
 * `env.params.kind` selects the platform; anything unrecognized draws nothing.
 */
export const platformGuideDraw: DrawFn = (ctx, e) => {
  const kind = e.params.kind;
  const g = typeof kind === "string" ? GUIDE[kind as PlatformGuideKind] : undefined;
  if (!g) return;

  const { width: w, height: h } = e;
  const stroke = Math.max(1, Math.round(w / 1080));

  // Top band, bottom band, right icon rail.
  const zones: [number, number, number, number][] = [
    [0, 0, w, h * g.top],
    [0, h - h * g.bottom, w, h * g.bottom],
    [w - w * g.rail, 0, w * g.rail, h],
  ];
  for (const [x, y, zw, zh] of zones) {
    ctx.fillStyle = "rgba(255, 80, 80, 0.28)";
    ctx.fillRect(x, y, zw, zh);
    ctx.strokeStyle = "rgba(255, 120, 120, 0.55)";
    ctx.lineWidth = stroke;
    // border-box: the CSS border sat inside the zone, so inset by half the stroke.
    ctx.strokeRect(x + stroke / 2, y + stroke / 2, zw - stroke, zh - stroke);
  }

  // Label chip. Sizes are fractions of the canvas rather than the CSS's fixed px so the chip
  // keeps its proportions at any supersample. CSS percentage padding resolves against WIDTH on
  // both axes, which is why padY is a width fraction too.
  const fontPx = h * 0.01146; // 22px at a 1920-tall composition
  const padX = w * 0.014;
  const padY = w * 0.006;
  const radius = w * 0.00556; // 6px at 1080 wide
  ctx.font = `700 ${fontPx}px Helvetica, Arial, sans-serif`;
  ctx.textBaseline = "top";
  const textW = ctx.measureText(g.label).width;
  const x = w * 0.03;
  const y = h * 0.03;
  const boxW = textW + padX * 2;
  const boxH = fontPx + padY * 2;

  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.beginPath();
  ctx.roundRect(x, y, boxW, boxH, radius);
  ctx.fill();

  ctx.fillStyle = "#fecaca";
  ctx.fillText(g.label, x + padX, y + padY);
};
