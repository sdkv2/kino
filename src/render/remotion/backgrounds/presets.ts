// Built-in animated background draw functions. Each is a PURE function of `env` (esp. env.frame)
// so Remotion captures it deterministically frame-by-frame. CanvasBackground clears + fills the
// night base each frame, then calls one of these. Custom backgrounds plug into the same contract.

export interface DrawEnv {
  frame: number;
  fps: number;
  width: number;
  height: number;
  colors: string[]; // brand palette (mint/green/gold by default)
  intensity: number; // 0..1 motion strength
}

export type DrawFn = (ctx: CanvasRenderingContext2D, env: DrawEnv) => void;

function withAlpha(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const clamped = Math.round(Math.min(1, Math.max(0, a)) * 255).toString(16).padStart(2, "0");
  return `#${full}${clamped}`;
}

// Slow morphing blobs of brand colour that blend into each other (Stripe/Linear vibe).
const mesh: DrawFn = (ctx, { frame, width, height, colors, intensity }) => {
  const amp = 0.06 + 0.28 * intensity;
  ctx.globalCompositeOperation = "lighter";
  colors.forEach((col, i) => {
    const cx = width * (0.5 + amp * Math.sin(frame / (90 + i * 28) + i * 2.1));
    const cy = height * (0.5 + amp * Math.cos(frame / (110 + i * 24) + i * 1.3));
    const r = Math.max(width, height) * (0.45 + 0.08 * Math.sin(frame / 70 + i));
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, withAlpha(col, 0.5));
    g.addColorStop(1, withAlpha(col, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  });
  ctx.globalCompositeOperation = "source-over";
};

// Flowing diagonal light ribbons that undulate, like aurora in brand colours.
const aurora: DrawFn = (ctx, { frame, width, height, colors, intensity }) => {
  ctx.globalCompositeOperation = "lighter";
  ctx.filter = "blur(38px)";
  const bands = 3;
  const sway = height * 0.1 * (0.5 + intensity);
  for (let i = 0; i < bands; i++) {
    const col = colors[i % colors.length];
    const baseY = height * (0.3 + 0.18 * i);
    const band = height * 0.2;
    ctx.beginPath();
    ctx.moveTo(0, baseY);
    const steps = 16;
    for (let s = 0; s <= steps; s++) {
      const x = (width * s) / steps;
      const y = baseY + Math.sin(frame / 50 + s / 2.4 + i * 1.7) * sway;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(width, baseY + band);
    ctx.lineTo(0, baseY + band);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, baseY - sway, 0, baseY + band);
    g.addColorStop(0, withAlpha(col, 0));
    g.addColorStop(0.5, withAlpha(col, 0.3));
    g.addColorStop(1, withAlpha(col, 0));
    ctx.fillStyle = g;
    ctx.fill();
  }
  ctx.filter = "none";
  ctx.globalCompositeOperation = "source-over";
};

// Drifting soft bokeh orbs with depth/parallax — energetic, social-native.
const particles: DrawFn = (ctx, { frame, width, height, colors, intensity }) => {
  const N = 46;
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < N; i++) {
    const col = colors[i % colors.length];
    const sx = ((i * 73) % 100) / 100;
    const sy = ((i * 137) % 100) / 100;
    const depth = 0.4 + (((i * 53) % 100) / 100) * 0.6;
    const speed = (0.15 + depth * 0.5) * (0.5 + intensity);
    const driftX = Math.sin(frame / 90 + i) * width * 0.015 * depth;
    const y = height * (1 - ((sy + (frame / 300) * speed) % 1));
    const x = width * sx + driftX;
    const r = 4 + depth * 14;
    const tw = 0.18 + 0.22 * (0.5 + 0.5 * Math.sin(frame / 22 + i * 1.7));
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, withAlpha(col, tw));
    g.addColorStop(1, withAlpha(col, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
};

// Perspective grid: converging verticals + horizontals scrolling toward the viewer — techy.
const grid: DrawFn = (ctx, { frame, width, height, colors, intensity }) => {
  const col = colors[0];
  const vpx = width / 2;
  const horizon = height * 0.42;
  ctx.lineWidth = 2;
  ctx.strokeStyle = withAlpha(col, 0.14);
  const cols = 12;
  for (let i = 0; i <= cols; i++) {
    const bx = (i / cols) * width;
    ctx.beginPath();
    ctx.moveTo(bx, height);
    ctx.lineTo(vpx + (bx - vpx) * 0.12, horizon);
    ctx.stroke();
  }
  const rows = 14;
  const scroll = ((frame / 60) * (0.5 + intensity)) % 1;
  for (let i = 0; i < rows; i++) {
    const p = (i + scroll) / rows;
    const y = horizon + (height - horizon) * (p * p);
    ctx.strokeStyle = withAlpha(col, Math.max(0.02, 0.16 * (1 - p)));
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
};

const PRESETS: Record<string, DrawFn> = { mesh, aurora, particles, grid };
export const PRESET_NAMES = Object.keys(PRESETS);
export function getPreset(name: string): DrawFn | undefined {
  return PRESETS[name];
}
