// The motion-graphic CSS contract, shared by the two surfaces that render motion markup:
// MotionGraphic (shadow root, host = `:host`) and the HTML texture rasterizer in bgTextures
// (foreignObject, host = a plain class — a raster has no shadow host, so `:host` would match
// nothing and every --kino-ease-* var would be undefined).
//
// All of it is determinism-safe: animations are force-paused and scrubbed by --progress (no wall
// clock), helpers read frame-driven vars only, and there are no transitions / external url()s. This
// is the canonical injection the motion-graphic contract (docs/motion-graphics.md, `kino motion`)
// documents — same bytes, same pixels.

/** Scrub CSS with the ease-var block scoped to `host` (`:host` for a shadow root, a class for a raster). */
export const motionScrubCss = (host: string): string =>
  "*{animation-play-state:paused !important;transition:none !important}" +
  `${host}{--kino-ease-in:cubic-bezier(.55,0,1,.45);--kino-ease-out:cubic-bezier(.22,1,.36,1);--kino-ease-in-out:cubic-bezier(.65,0,.35,1);` +
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
  ".kino-camera{filter:blur(calc(var(--cam-blur,0) * 1px));will-change:transform,filter}" +
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
  ".kino-shadow{filter:drop-shadow(0 12px 26px rgba(0,0,0,.32))}" +
  ".kino-glass-shape{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;opacity:0}";

/** The same rules as a ready-to-inject <style> element. */
export const motionScrubStyle = (host: string): string => `<style>${motionScrubCss(host)}</style>`;

// SVG filter library referenced from agent CSS via filter:url(#kino-…). Static + seeded → identical
// every frame (deterministic). Bare filter elements: inside a raster they are injected directly into
// the SVG document (already the SVG namespace), where a nested unprefixed <svg> would not be.
export const KINO_FILTERS =
  '<filter id="kino-grain" x="0" y="0" width="100%" height="100%">' +
  '<feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="11" stitchTiles="stitch"/>' +
  '<feColorMatrix type="saturate" values="0"/></filter>' +
  '<filter id="kino-displace" x="-10%" y="-10%" width="120%" height="120%">' +
  '<feTurbulence type="fractalNoise" baseFrequency="0.01 0.014" numOctaves="2" seed="3" result="t"/>' +
  '<feDisplacementMap in="SourceGraphic" in2="t" scale="20" xChannelSelector="R" yChannelSelector="G"/></filter>';

/** The same filters as a hidden HTML-embeddable <svg> (for the shadow-root surface). */
export const KINO_DEFS =
  '<svg width="0" height="0" aria-hidden="true" style="position:absolute">' + KINO_FILTERS + "</svg>";
