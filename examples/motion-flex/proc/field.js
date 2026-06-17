// Tier-2 procedural graphic. Demonstrates COMPUTED GEOMETRY + per-frame JS motion: N dots placed
// on a spiral by a formula, with positions recomputed every frame from env.t (a rotation no CSS
// keyframe can express). Colours come from env.palette; entrance staggers on env.progress; the glow
// swells on env.pulse. Pure (env) → string — deterministic.
const N = 36, cx = env.width / 2, cy = env.height * 0.45;
const c01 = (v) => Math.max(0, Math.min(1, v));
const spin = env.t * 9; // degrees/sec — continuous, JS-computed
let dots = "";
for (let i = 0; i < N; i++) {
  const f = i / (N - 1);
  const ang = (f * 720 + spin) * Math.PI / 180; // two turns + rotation
  const rad = 70 + f * 380;
  const x = (cx + Math.cos(ang) * rad).toFixed(1);
  const y = (cy + Math.sin(ang) * rad).toFixed(1);
  const sz = (10 + f * 18).toFixed(1);
  const col = i % 3 === 0 ? env.palette.gold : i % 3 === 1 ? env.palette.mint : env.palette.white;
  const op = c01((env.progress - f * 0.4) * 5).toFixed(3); // staggered reveal
  const glow = (10 + env.pulse * 22).toFixed(1);
  dots += `<div class="d" style="left:${x}px;top:${y}px;width:${sz}px;height:${sz}px;margin:-${sz / 2}px;` +
    `background:${col};opacity:${op};box-shadow:0 0 ${glow}px ${col}"></div>`;
}
return `<style>
  .stage{position:absolute;inset:0;font-family:var(--kino-font);overflow:hidden;
         opacity:clamp(0, calc((1 - var(--progress)) * 10), 1)}
  .kick{position:absolute;top:13%;width:100%;text-align:center;color:var(--kino-mint);
        font-weight:800;font-size:30px;letter-spacing:.42em}
  .d{position:absolute;border-radius:50%}
  .core{position:absolute;left:50%;top:45%;width:150px;height:150px;margin:-75px;border-radius:50%;
        background:radial-gradient(circle, rgba(128,226,180, calc(.18 + var(--pulse) * .3)), transparent 70%);
        transform:scale(calc(1 + var(--pulse) * .15))}
  .vig{position:absolute;inset:0;pointer-events:none;
       background:radial-gradient(ellipse 80% 70% at 50% 45%, transparent 44%, rgba(4,7,14,.55))}
  .beat{position:absolute;bottom:7%;left:0;right:0;display:flex;gap:13px;justify-content:center}
  .beat i{width:13px;height:13px;border-radius:99px;background:rgba(255,255,255,.16)}
  .beat i.on{width:46px;background:var(--kino-mint)}
</style>
<div class="stage">
  <div class="kick">COMPUTED GEOMETRY</div>
  <div class="core"></div>
  ${dots}
  <div class="vig"></div>
  <div class="beat"><i></i><i class="on"></i><i></i></div>
</div>`;
