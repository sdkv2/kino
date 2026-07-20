// brand-wash — authored faceless backdrop (prefer over stock mesh).
// Body of draw(ctx, env). Uses env.params colorA/B/C + intensity + env.pulse + env.frame.
// Deterministic: motion from frame only. Copy into a project or reference as bare id "brand-wash".
var w = env.width, h = env.height, f = env.frame;
var a = typeof env.params.colorA === "string" ? env.params.colorA : "#80e2b4";
var b = typeof env.params.colorB === "string" ? env.params.colorB : "#0c8d64";
var c = typeof env.params.colorC === "string" ? env.params.colorC : "#d99a20";
var intensity = typeof env.params.intensity === "number" ? env.params.intensity : 0.5;
var pulse = 1 + 0.55 * (env.pulse || 0);

function hexAlpha(hex, alpha) {
  var h = String(hex).replace("#", "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  var n = Math.round(Math.min(1, Math.max(0, alpha)) * 255).toString(16).padStart(2, "0");
  return "#" + h.slice(0, 6) + n;
}

// Horizon wash — two soft columns + a slow gold ribbon. Reads as a brand stage, not a SaaS mesh.
var sway = 0.04 + 0.1 * intensity;
var cx1 = w * (0.28 + sway * Math.sin(f / 140));
var cx2 = w * (0.72 + sway * Math.cos(f / 160));
var cy = h * 0.38;

ctx.globalCompositeOperation = "lighter";

var g1 = ctx.createRadialGradient(cx1, cy, 0, cx1, cy, Math.max(w, h) * 0.55);
g1.addColorStop(0, hexAlpha(a, 0.42 * pulse));
g1.addColorStop(1, hexAlpha(a, 0));
ctx.fillStyle = g1;
ctx.fillRect(0, 0, w, h);

var g2 = ctx.createRadialGradient(cx2, cy + h * 0.08, 0, cx2, cy + h * 0.08, Math.max(w, h) * 0.5);
g2.addColorStop(0, hexAlpha(b, 0.32 * pulse));
g2.addColorStop(1, hexAlpha(b, 0));
ctx.fillStyle = g2;
ctx.fillRect(0, 0, w, h);

// Thin accent ribbon across the mid-third (moves slowly; intensity scales amplitude)
var y0 = h * (0.52 + 0.03 * intensity * Math.sin(f / 90));
var ribbon = ctx.createLinearGradient(0, y0 - h * 0.08, w, y0 + h * 0.08);
ribbon.addColorStop(0, hexAlpha(c, 0));
ribbon.addColorStop(0.45, hexAlpha(c, 0.18 * pulse * (0.5 + intensity)));
ribbon.addColorStop(0.55, hexAlpha(c, 0.18 * pulse * (0.5 + intensity)));
ribbon.addColorStop(1, hexAlpha(c, 0));
ctx.fillStyle = ribbon;
ctx.fillRect(0, y0 - h * 0.1, w, h * 0.2);

ctx.globalCompositeOperation = "source-over";
