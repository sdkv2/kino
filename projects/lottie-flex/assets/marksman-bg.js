// Marksman / spec-sheet frame, drawn flat on the cream base (env.night is pre-filled).
// Pure function of env.frame → deterministic. env = { frame, fps, width, height, params, pulse }.
const W = env.width, H = env.height, frame = env.frame;
const ink = "#16130D";
const grey = "rgba(22,19,13,0.40)";
const faint = "rgba(22,19,13,0.05)";

// 1. Faint technical grid.
ctx.strokeStyle = faint;
ctx.lineWidth = 2;
const step = Math.round(W / 9);
ctx.beginPath();
for (let x = step; x < W; x += step) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); }
for (let y = step; y < H; y += step) { ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); }
ctx.stroke();

// 2. Inset frame margin + corner registration brackets (camera viewfinder).
const M = Math.round(W * 0.055);
const arm = Math.round(W * 0.075);
ctx.strokeStyle = ink;
ctx.lineCap = "butt";
ctx.lineWidth = 5;
const corners = [[M, M, 1, 1], [W - M, M, -1, 1], [M, H - M, 1, -1], [W - M, H - M, -1, -1]];
for (const c of corners) {
  ctx.beginPath();
  ctx.moveTo(c[0], c[1] + c[3] * arm);
  ctx.lineTo(c[0], c[1]);
  ctx.lineTo(c[0] + c[2] * arm, c[1]);
  ctx.stroke();
}

// 3. Edge registration ticks along the inset frame (ruler marks).
ctx.strokeStyle = grey;
ctx.lineWidth = 2;
const tick = Math.round(W * 0.012);
ctx.beginPath();
for (let x = M + step; x < W - M; x += step) {
  ctx.moveTo(x + 0.5, M); ctx.lineTo(x + 0.5, M + tick);
  ctx.moveTo(x + 0.5, H - M); ctx.lineTo(x + 0.5, H - M - tick);
}
for (let y = M + step; y < H - M; y += step) {
  ctx.moveTo(M, y + 0.5); ctx.lineTo(M + tick, y + 0.5);
  ctx.moveTo(W - M, y + 0.5); ctx.lineTo(W - M - tick, y + 0.5);
}
ctx.stroke();

// 4. Mono spec-sheet labels: a fixed mark + a live frame counter (deterministic, keyed to env.frame).
ctx.fillStyle = grey;
ctx.textBaseline = "alphabetic";
const lab = Math.round(W * 0.021);
ctx.font = lab + "px monospace";
ctx.textAlign = "left";
ctx.fillText("kino · motion", M + 6, M - Math.round(W * 0.018));
ctx.textAlign = "right";
const fr = String(frame).padStart(4, "0");
ctx.fillText("FR " + fr + " — 9:16", W - M - 6, M - Math.round(W * 0.018));
ctx.textAlign = "left";
ctx.fillText("DETERMINISTIC", M + 6, H - M + Math.round(W * 0.033));
ctx.textAlign = "right";
ctx.fillText("··· REC", W - M - 6, H - M + Math.round(W * 0.033));
