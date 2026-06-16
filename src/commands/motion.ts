// Discovery: print the CSS-variable contract + rules an agent codes a motion-graphic HTML file
// against. Mirrors `kino backgrounds`/`kino elements`. The graphic is referenced from the spec
// (kind:"motion" or motionOverlay) and driven entirely by these kino-set variables.
export function motionHelpText(): string {
  return [
    "Motion graphics — author a self-contained HTML/CSS file in assets/motion/, reference it from",
    'the spec ({ "kind": "motion", "source": "motion/x.html", "text": "..." } or "motionOverlay").',
    "JSON owns timing; your CSS reads kino-set variables. Motion = a function of these vars:",
    "",
    "  --frame      integer frame within the beat",
    "  --t          seconds within the beat",
    "  --progress   0 → 1 across the beat (use for entrances/reveals)",
    "  --pulse      0 → 1 envelope fired by spec triggers ({ at, action:'pulse' })",
    "  --<param>    every key in the spec's params, tweened by keyframes (e.g. --pct)",
    "  --kino-green --kino-night --kino-white --kino-mint   brand palette",
    "  --kino-font  brand font family",
    "",
    "Example (a bar that grows to --pct and a title that rises in):",
    "  <style>",
    "    .bar   { position:absolute; left:8%; bottom:30%; height:48px;",
    "             width:calc(var(--pct) * 1%); background:var(--kino-mint); border-radius:8px; }",
    "    .title { position:absolute; left:8%; bottom:38%; font-family:var(--kino-font);",
    "             color:var(--kino-white); font-weight:900; font-size:64px;",
    "             opacity:var(--progress);",
    "             transform:translateY(calc((1 - var(--progress)) * 40px)); }",
    "  </style>",
    "  <div class='title'>86% match</div><div class='bar'></div>",
    "",
    "Drive it from the spec:",
    '  "params": { "pct": 0 }, "keyframes": [{ "at": 0.2, "params": { "pct": 86 }, "ease": "overshoot" }]',
    "",
    "Rules (the build rejects violations):",
    "  · No @keyframes, no CSS transition, no <script>, no JS timers/RAF, no Date.now/Math.random.",
    "    Animate by reading the variables above — kino sets them every frame.",
    "  · Inline images as data: URIs (external/relative url() won't resolve in the render).",
    "  · Sync timings to the VO with `kino inspect` (per-word start/end).",
    "",
  ].join("\n");
}

export async function motion(): Promise<void> {
  process.stdout.write(motionHelpText());
}
