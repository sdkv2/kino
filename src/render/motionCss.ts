// Trusted stylesheet + SVG defs injected into every motion-graphic shadow root — page bundle
// (MotionGraphic.tsx) and the scene screen rasterizer (scene/rasterize.ts) must inject identical
// bytes, so this lives outside the page. All of it is determinism-safe: animations are
// force-paused and scrubbed by --progress (no wall clock); no transitions / external url()s.

// Trusted stylesheet injected into every motion-graphic shadow root. All of it is determinism-safe:
// animations are force-paused and scrubbed by --progress (no wall clock), helpers read frame-driven
// vars only, and there are no transitions / external url()s. This is the canonical injection the
// motion-graphic contract (docs/motion-graphics.md, `kino motion`) documents — same bytes, same pixels.
export const KINO_SCRUB_STYLE =
  "<style>*{animation-play-state:paused !important;transition:none !important}" +
  ":host{--kino-ease-out:cubic-bezier(.22,1,.36,1);--kino-ease-in-out:cubic-bezier(.65,0,.35,1);" +
  "--kino-ease-overshoot:cubic-bezier(.34,1.56,.64,1);--kino-ease-spring:cubic-bezier(.22,1.4,.3,1)}" +
  ".kino-anim,.kino-rise,.kino-blur-rise,.kino-pop,.kino-wipe{animation-duration:1s !important;" +
  "animation-fill-mode:both !important;animation-iteration-count:1 !important;" +
  "animation-delay:calc((var(--progress) - var(--kino-delay, 0)) * -1s) !important}" +
  ".kino-rise{animation-name:kino-rise;animation-timing-function:var(--kino-ease-out)}" +
  ".kino-blur-rise{animation-name:kino-blur-rise;animation-timing-function:var(--kino-ease-out)}" +
  ".kino-pop{animation-name:kino-pop;animation-timing-function:var(--kino-ease-overshoot)}" +
  ".kino-wipe{animation-name:kino-wipe;animation-timing-function:var(--kino-ease-in-out)}" +
  "@keyframes kino-rise{0%{opacity:0;transform:translateY(var(--kino-rise-y,42px))}35%{opacity:1;transform:none}100%{opacity:1;transform:none}}" +
  "@keyframes kino-blur-rise{0%{opacity:0;filter:blur(16px);transform:translateY(26px)}45%{opacity:1;filter:blur(0);transform:none}100%{opacity:1;filter:blur(0);transform:none}}" +
  "@keyframes kino-pop{0%{opacity:0;transform:scale(.7)}40%{opacity:1;transform:scale(1.08)}70%{transform:scale(1)}100%{opacity:1;transform:scale(1)}}" +
  "@keyframes kino-wipe{0%{clip-path:inset(0 100% 0 0)}40%{clip-path:inset(0 0 0 0)}100%{clip-path:inset(0 0 0 0)}}" +
  ".kino-pulse{opacity:var(--pulse,0);transform:scale(calc(.88 + var(--pulse,0) * .18))}" +
  ".kino-cliptext{padding-inline:.12em;margin-inline:-.12em}" +
  ".kino-fade-edges{-webkit-mask-image:linear-gradient(180deg,transparent,#000 7%,#000 93%,transparent);" +
  "mask-image:linear-gradient(180deg,transparent,#000 7%,#000 93%,transparent)}" +
  ".kino-grain{position:absolute;inset:0;pointer-events:none;filter:url(#kino-grain);" +
  "opacity:.5;mix-blend-mode:overlay}" +
  ".kino-vignette{position:absolute;inset:0;pointer-events:none;" +
  "background:radial-gradient(75% 70% at 50% 50%,transparent 42%,rgba(0,0,0,.55) 100%)}" +
  ".kino-mesh{background:radial-gradient(60% 60% at 18% 22%,var(--kino-mint),transparent 60%)," +
  "radial-gradient(55% 55% at 82% 28%,var(--kino-gold),transparent 60%)," +
  "radial-gradient(70% 70% at 50% 92%,var(--kino-green),transparent 65%),var(--kino-night)}" +
  ".kino-shadow{filter:drop-shadow(0 12px 26px rgba(0,0,0,.32))}</style>";

// Injected SVG filter library (trusted, alongside KINO_SCRUB_STYLE). Static + seeded → identical
// every frame (deterministic). Referenced from agent CSS via filter:url(#kino-…).
export const KINO_DEFS =
  '<svg width="0" height="0" aria-hidden="true" style="position:absolute">' +
  '<filter id="kino-grain" x="0" y="0" width="100%" height="100%">' +
  '<feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="11" stitchTiles="stitch"/>' +
  '<feColorMatrix type="saturate" values="0"/></filter>' +
  '<filter id="kino-displace" x="-10%" y="-10%" width="120%" height="120%">' +
  '<feTurbulence type="fractalNoise" baseFrequency="0.01 0.014" numOctaves="2" seed="3" result="t"/>' +
  '<feDisplacementMap in="SourceGraphic" in2="t" scale="20" xChannelSelector="R" yChannelSelector="G"/></filter>' +
  "</svg>";
