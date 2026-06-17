// Tier-2 procedural graphic. Demonstrates GENERATIVE per-frame motion: a row of N bars whose heights
// follow a sine wave that travels across the screen over time (env.t), each bar's colour mixed by its
// position. Heights are computed in JS every frame. A gradient-clipped "kino" wordmark (kino-cliptext)
// rises over it. Pure (env) → string — deterministic.
const N = 34;
const c01 = (v) => Math.max(0, Math.min(1, v));
const reveal = c01(env.progress * 3); // wave grows in over the first third of the beat
let bars = "";
for (let i = 0; i < N; i++) {
  const f = i / (N - 1);
  const wave = Math.sin(f * Math.PI * 3 - env.t * 4) * 0.5 + 0.5; // 0..1, travelling
  const h = ((4 + wave * 22) * reveal).toFixed(2); // % of height
  const x = (5 + f * 90).toFixed(2);
  const col = `color-mix(in srgb, ${env.palette.mint}, ${env.palette.gold} ${Math.round(f * 100)}%)`;
  bars += `<div class="b" style="left:${x}%;height:${h}%;background:${col}"></div>`;
}
return `<style>
  .stage{position:absolute;inset:0;font-family:var(--kino-font);overflow:hidden;
         opacity:clamp(0, calc((1 - var(--progress)) * 10), 1)}
  .kick{position:absolute;top:13%;width:100%;text-align:center;color:var(--kino-mint);
        font-weight:800;font-size:30px;letter-spacing:.42em}
  .b{position:absolute;bottom:12%;width:1.5%;border-radius:99px;opacity:.9;
     box-shadow:0 0 calc(4px + var(--pulse) * 16px) rgba(128,226,180,.5)}
  .mark{position:absolute;top:40%;width:100%;text-align:center;font-weight:900;font-size:150px;letter-spacing:-.03em;
        background:linear-gradient(120deg, var(--kino-white), var(--kino-mint));
        -webkit-background-clip:text;background-clip:text;color:transparent;
        opacity:clamp(0, calc((var(--progress) - .15) * 4), 1);
        transform:translateY(calc((1 - clamp(0, calc((var(--progress) - .15) * 4), 1)) * 24px))}
  .sub{position:absolute;top:56%;width:100%;text-align:center;color:#9fb1c9;font-weight:700;font-size:26px;
       letter-spacing:.2em;opacity:clamp(0, calc((var(--progress) - .35) * 4), 1)}
  .vig{position:absolute;inset:0;pointer-events:none;
       background:radial-gradient(ellipse 80% 70% at 50% 48%, transparent 46%, rgba(4,7,14,.55))}
  .beat{position:absolute;bottom:7%;left:0;right:0;display:flex;gap:13px;justify-content:center}
  .beat i{width:13px;height:13px;border-radius:99px;background:rgba(255,255,255,.16)}
  .beat i.on{width:46px;background:var(--kino-mint)}
</style>
<div class="stage">
  <div class="kick">GENERATIVE</div>
  ${bars}
  <div class="mark kino-cliptext">kino</div>
  <div class="sub">RENDER(ENV) IN JAVASCRIPT</div>
  <div class="vig"></div>
  <div class="beat"><i></i><i></i><i class="on"></i></div>
</div>`;
