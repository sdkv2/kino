// The single MotionEnv builder shared by the browser motion-graphic layer (Tier-2 proc) and the
// node-side 3D scene runner (runScene). Pure function of (frame, beat timing, JSON controls) — only
// bgparams math, so it runs identically in the page and in Node. Moved here from MotionGraphic.tsx.
import type { Theme, MotionGraphicProps, MotionEnv } from "./props.js";
import { paramsAt, pulseAt, progressCurves } from "./bgparams.js";

/** One env across 2D proc and 3D scenes: pure function of (frame, beat timing, JSON controls). */
export function buildMotionEnv(a: {
  frame: number; fps: number; width: number; height: number; durationFrames: number;
  data: MotionGraphicProps; t: Theme;
}): MotionEnv {
  const tt = a.frame / a.fps;
  const resolved = paramsAt(a.data.params, a.data.keyframes, tt, { implicitBase: true });
  const curves = progressCurves(a.durationFrames > 0 ? Math.min(1, Math.max(0, a.frame / a.durationFrames)) : 0);
  return {
    frame: a.frame, t: tt,
    progress: a.durationFrames > 0 ? Math.min(1, Math.max(0, a.frame / a.durationFrames)) : 0,
    out: curves.out, inout: curves.inout, overshoot: curves.overshoot, spring: curves.spring, edge: curves.edge,
    pulse: pulseAt(a.data.triggers, tt),
    params: resolved,
    palette: { mint: a.t.mint, green: a.t.green, night: a.t.night, white: a.t.white, gold: a.t.gold, font: a.t.font },
    width: a.width, height: a.height,
    words: a.data.words ?? [],
    durationFrames: a.durationFrames,
    duration: a.fps > 0 ? a.durationFrames / a.fps : 0,
  };
}
