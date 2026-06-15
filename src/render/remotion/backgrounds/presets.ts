// Built-in animated background draw functions. Each is a PURE function of `env` (esp. env.frame +
// env.params + env.pulse) so Remotion captures it deterministically. params are tweened by the agent's
// keyframes (see render/bgparams); pulse is a 0..1 envelope fired by triggers. Custom backgrounds get
// the same env. PRESET_SCHEMAS documents the controllable params/actions (surfaced by `kino backgrounds`).

export type ParamValue = number | string;

export interface DrawEnv {
  frame: number;
  fps: number;
  width: number;
  height: number;
  params: Record<string, ParamValue>; // resolved at this frame (colorA/B/C, intensity, …)
  pulse: number; // 0..1 from triggers
}

export type DrawFn = (ctx: CanvasRenderingContext2D, env: DrawEnv) => void;

const num = (e: DrawEnv, k: string, d = 0): number => {
  const v = e.params[k];
  return typeof v === "number" ? v : Number(v) || d;
};
const col = (e: DrawEnv, k: string, d = "#ffffff"): string => {
  const v = e.params[k];
  return typeof v === "string" ? v : d;
};

function withAlpha(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const clamped = Math.round(Math.min(1, Math.max(0, a)) * 255).toString(16).padStart(2, "0");
  return `#${full.slice(0, 6)}${clamped}`;
}

const mesh: DrawFn = (ctx, e) => {
  const { frame, width, height } = e;
  const intensity = num(e, "intensity", 0.5);
  const cols = [col(e, "colorA"), col(e, "colorB"), col(e, "colorC")];
  const amp = 0.06 + 0.28 * intensity;
  const boost = 1 + 0.8 * e.pulse;
  ctx.globalCompositeOperation = "lighter";
  cols.forEach((c, i) => {
    const cx = width * (0.5 + amp * Math.sin(frame / (90 + i * 28) + i * 2.1));
    const cy = height * (0.5 + amp * Math.cos(frame / (110 + i * 24) + i * 1.3));
    const r = Math.max(width, height) * (0.45 + 0.08 * Math.sin(frame / 70 + i));
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, withAlpha(c, 0.5 * boost));
    g.addColorStop(1, withAlpha(c, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  });
  ctx.globalCompositeOperation = "source-over";
};

const aurora: DrawFn = (ctx, e) => {
  const { frame, width, height } = e;
  const intensity = num(e, "intensity", 0.5);
  const cols = [col(e, "colorA"), col(e, "colorB"), col(e, "colorC")];
  const boost = 1 + 0.8 * e.pulse;
  ctx.globalCompositeOperation = "lighter";
  ctx.filter = "blur(38px)";
  const sway = height * 0.1 * (0.5 + intensity);
  for (let i = 0; i < 3; i++) {
    const c = cols[i % cols.length];
    const baseY = height * (0.3 + 0.18 * i);
    const band = height * 0.2;
    ctx.beginPath();
    ctx.moveTo(0, baseY);
    for (let s = 0; s <= 16; s++) {
      const x = (width * s) / 16;
      const y = baseY + Math.sin(frame / 50 + s / 2.4 + i * 1.7) * sway;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(width, baseY + band);
    ctx.lineTo(0, baseY + band);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, baseY - sway, 0, baseY + band);
    g.addColorStop(0, withAlpha(c, 0));
    g.addColorStop(0.5, withAlpha(c, 0.3 * boost));
    g.addColorStop(1, withAlpha(c, 0));
    ctx.fillStyle = g;
    ctx.fill();
  }
  ctx.filter = "none";
  ctx.globalCompositeOperation = "source-over";
};

const particles: DrawFn = (ctx, e) => {
  const { frame, width, height } = e;
  const intensity = num(e, "intensity", 0.5);
  const cols = [col(e, "colorA"), col(e, "colorB"), col(e, "colorC")];
  const boost = 1 + 1.2 * e.pulse;
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 46; i++) {
    const c = cols[i % cols.length];
    const sx = ((i * 73) % 100) / 100;
    const sy = ((i * 137) % 100) / 100;
    const depth = 0.4 + (((i * 53) % 100) / 100) * 0.6;
    const speed = (0.15 + depth * 0.5) * (0.5 + intensity);
    const x = width * sx + Math.sin(frame / 90 + i) * width * 0.015 * depth;
    const y = height * (1 - ((sy + (frame / 300) * speed) % 1));
    const r = (4 + depth * 14) * (1 + 0.3 * e.pulse);
    const tw = (0.18 + 0.22 * (0.5 + 0.5 * Math.sin(frame / 22 + i * 1.7))) * boost;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, withAlpha(c, tw));
    g.addColorStop(1, withAlpha(c, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
};

const grid: DrawFn = (ctx, e) => {
  const { frame, width, height } = e;
  const intensity = num(e, "intensity", 0.5);
  const c = col(e, "colorA");
  const boost = 1 + 1.2 * e.pulse;
  const vpx = width / 2;
  const horizon = height * 0.42;
  ctx.lineWidth = 2;
  ctx.strokeStyle = withAlpha(c, 0.14 * boost);
  for (let i = 0; i <= 12; i++) {
    const bx = (i / 12) * width;
    ctx.beginPath();
    ctx.moveTo(bx, height);
    ctx.lineTo(vpx + (bx - vpx) * 0.12, horizon);
    ctx.stroke();
  }
  const scroll = ((frame / 60) * (0.5 + intensity)) % 1;
  for (let i = 0; i < 14; i++) {
    const p = (i + scroll) / 14;
    const y = horizon + (height - horizon) * (p * p);
    ctx.strokeStyle = withAlpha(c, Math.max(0.02, 0.16 * (1 - p)) * boost);
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
