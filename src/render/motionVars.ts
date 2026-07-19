import type { Theme, BgParamValue } from "./props.js";

export interface MotionVarDynamics {
  frame: number;
  t: number;
  progress: number;
  pulse: number;
  params: Record<string, BgParamValue>;
  captionBottom?: number; // px from frame bottom where the caption band sits (0 = no caption this beat)
}

// Build the CSS custom properties set on a motion-graphic host every frame. The agent's shadow-scoped
// CSS reads these (they inherit across the shadow boundary): the frame-driven vars, every resolved
// spec param as --<key>, and the brand palette. Pure so it's unit-testable.
//   NOTE: --kino-gold (and the legacy --gold alias the shipped motion-flex examples use) MUST be here —
//   omitting gold silently renders any gold-referencing declaration invalid (invisible, no error).
export function buildMotionVars(t: Theme, dyn: MotionVarDynamics): Record<string, string> {
  const vars: Record<string, string> = {
    "--frame": String(dyn.frame),
    "--t": dyn.t.toFixed(4),
    "--progress": dyn.progress.toFixed(4),
    "--pulse": dyn.pulse.toFixed(4),
    "--kino-green": t.green,
    "--kino-night": t.night,
    "--kino-white": t.white,
    "--kino-mint": t.mint,
    "--kino-gold": t.gold,
    "--gold": t.gold, // legacy alias used by examples/motion-flex/*.html
    "--kino-font": t.font,
    // Second typeface for label/mono-style text inside a motion beat, distinct from the caption
    // font — falls back to --kino-font so it's never invalid when the brand sets no labelFont.
    "--kino-label-font": t.labelFont ?? t.font,
    // The caption band bottom (px from frame bottom; 0 when this beat has no caption) so authors can
    // position their own text clear of kino's auto caption, e.g. bottom: calc(var(--kino-caption-bottom) + 24px).
    "--kino-caption-bottom": `${dyn.captionBottom ?? 0}px`,
  };
  for (const [k, v] of Object.entries(dyn.params)) vars[`--${k}`] = String(v);
  return vars;
}
