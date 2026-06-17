// Tier-2 procedural graphic (body of render(env) → HTML). Demonstrates DATA-DRIVEN layout:
// the bars, value labels and axis labels are all generated from a data array with a loop —
// painful to hand-author as static HTML. Bar growth is driven by eased, staggered per-bar tweens
// (var(--g<i>), overshoot — defined in the spec, so JSON owns the timing); the glow swells on var(--pulse).
const data = [
  { l: "MON", v: 42 }, { l: "TUE", v: 61 }, { l: "WED", v: 54 },
  { l: "THU", v: 78 }, { l: "FRI", v: 69 }, { l: "SAT", v: 96 },
];
const n = data.length, bw = 10, gap = (100 - n * bw) / (n + 1), maxH = 44; // %
let bars = "";
for (let i = 0; i < n; i++) {
  const d = data[i];
  const x = (gap + i * (bw + gap)).toFixed(2);
  const g = `var(--g${i})`; // eased, staggered grow-in (overshoot), tweened in the spec — not a linear ramp
  const h = ((d.v / 100) * maxH).toFixed(2);
  bars +=
    `<div class="bar" style="left:${x}%;height:${h}%;transform:scaleY(${g})"></div>` +
    `<div class="val" style="left:${x}%;bottom:calc(25% + ${h}% * ${g});opacity:${g}">${d.v}</div>` +
    `<div class="lab" style="left:${x}%">${d.l}</div>`;
}
return `<style>
  .stage{position:absolute;inset:0;font-family:var(--kino-font);overflow:hidden;
         opacity:clamp(0, calc((1 - var(--progress)) * 10), 1)}
  .kick{position:absolute;top:13%;width:100%;text-align:center;color:var(--kino-mint);
        font-weight:800;font-size:30px;letter-spacing:.42em}
  .base{position:absolute;bottom:25%;left:6%;right:6%;height:3px;border-radius:9px;background:rgba(255,255,255,.16)}
  .bar{position:absolute;bottom:25%;width:${bw}%;border-radius:12px 12px 0 0;transform-origin:bottom;
       background:linear-gradient(180deg, var(--kino-mint), var(--kino-green));
       box-shadow:0 0 calc(8px + var(--pulse) * 26px) rgba(128,226,180,.7)}
  .val{position:absolute;width:${bw}%;text-align:center;color:var(--kino-white);font-weight:800;font-size:34px;
       margin-bottom:10px}
  .lab{position:absolute;bottom:18%;width:${bw}%;text-align:center;color:#9fb1c9;font-weight:700;font-size:22px;letter-spacing:.12em}
  .vig{position:absolute;inset:0;pointer-events:none;
       background:radial-gradient(ellipse 80% 70% at 50% 45%, transparent 46%, rgba(4,7,14,.55))}
  .beat{position:absolute;bottom:7%;left:0;right:0;display:flex;gap:13px;justify-content:center}
  .beat i{width:13px;height:13px;border-radius:99px;background:rgba(255,255,255,.16)}
  .beat i.on{width:46px;background:var(--kino-mint)}
</style>
<div class="stage">
  <div class="kick">DATA-DRIVEN</div>
  <div class="base"></div>
  ${bars}
  <div class="vig"></div>
  <div class="beat"><i class="on"></i><i></i><i></i></div>
</div>`;
