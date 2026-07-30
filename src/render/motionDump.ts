// `kino still --dump-html`: the exact markup a motion beat produced at a given frame.
//
// Why this exists. A Tier-2 graphic builds its markup at render time, in the page, so when a layer
// comes out blank there is nothing to read — the source looks right and the frame shows nothing. The
// motivating case: a stray unary plus (`'x' + + f()`) coerced a <filter> definition to a Number, so
// the markup carried the literal string "NaN" where the filter should have been, and every element
// referencing that id rendered nothing at all. Invisible in the source, invisible in the frame, and
// five renders of bisecting to localise. In the dump it is one line of text.
//
// Fidelity is the whole point: the frame state comes from `motionFrameState`, the SAME function the
// in-page compositor provider calls, so a dumped frame is what rendered rather than a plausible
// reconstruction. (Verified pixel-identical when that extraction landed.)
//
// TRUST BOUNDARY: evaluating a Tier-2 proc here runs the graphic's code in Node rather than in the
// page. That is the same code the renderer executes and the same lint gates it (no require/import/
// process/eval/network — see motiongraphic.ts BANNED_JS), but it is opt-in behind a flag and is
// never part of a build.
import type { KinoProps, KinoSegment, MotionEnv, MotionGraphicProps } from "./props.js";
import { motionFrameState } from "./motionVars.js";
import { sanitizeMotionHtml } from "./sanitizeMotion.js";

export interface MotionDump {
  segment: number;
  /** Frame on the whole timeline, and the beat-relative frame the graphic actually saw. */
  frame: number;
  localFrame: number;
  tier: "html" | "proc" | "lottie";
  /** Which slot the graphic occupies — a beat can carry both a motion graphic and an overlay. */
  slot: "beat" | "overlay";
  html: string;
  vars: Record<string, string>;
  /** Set when a Tier-2 proc threw; `html` is then empty, exactly as the renderer would leave it. */
  error?: string;
}

function tierOf(data: MotionGraphicProps): MotionDump["tier"] {
  if (data.lottie) return "lottie";
  if (data.proc) return "proc";
  return "html";
}

function dumpOne(
  data: MotionGraphicProps,
  props: KinoProps,
  dims: Dims,
  seg: KinoSegment,
  segment: number,
  frame: number,
  slot: MotionDump["slot"],
): MotionDump {
  const fps = props.fps;
  const localFrame = frame - Math.round(seg.startSec * fps);
  const durationFrames = Math.max(1, Math.round((seg.endSec - seg.startSec) * fps));
  const { env, vars } = motionFrameState(data, {
    local: localFrame,
    fps,
    durationFrames,
    theme: props.theme,
    width: dims.width,
    height: dims.height,
  });
  const base: MotionDump = { segment, frame, localFrame, tier: tierOf(data), slot, html: data.html, vars };
  if (!data.proc || data.lottie) return base;
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function("env", data.proc) as (e: MotionEnv) => unknown;
    return { ...base, html: sanitizeMotionHtml(String(fn(env) ?? "")) };
  } catch (e) {
    // The renderer swallows a throwing proc into an empty frame; surface the reason instead, since
    // "my beat is blank" is precisely the question this command is being asked.
    return { ...base, html: "", error: (e as Error).message };
  }
}

/** Composition pixel dimensions — the same `width`/`height` the renderer hands a graphic's env. */
export interface Dims { width: number; height: number }

/** Every motion graphic live at `frame` — the beat's own graphic and/or its overlay. */
export function dumpMotionAt(props: KinoProps, dims: Dims, frame: number): MotionDump[] {
  const fps = props.fps;
  const t = fps > 0 ? frame / fps : 0;
  const out: MotionDump[] = [];
  props.segments.forEach((seg, i) => {
    if (t < seg.startSec || t > seg.endSec) return;
    if (seg.motion) out.push(dumpOne(seg.motion, props, dims, seg, i, frame, "beat"));
    const overlay = (seg as { motionOverlay?: MotionGraphicProps }).motionOverlay;
    if (overlay) out.push(dumpOne(overlay, props, dims, seg, i, frame, "overlay"));
  });
  return out;
}

/** A readable header so a dumped file says which beat, frame and params it came from. */
export function dumpHeader(d: MotionDump): string {
  const params = Object.entries(d.vars)
    .filter(([k]) => !k.startsWith("--kino-"))
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n     ");
  return (
    `<!-- kino --dump-html\n` +
    `     segment ${d.segment} (${d.slot}, tier ${d.tier}) · timeline frame ${d.frame} · beat frame ${d.localFrame}\n` +
    (d.error ? `     PROC THREW: ${d.error}\n` : "") +
    `     ${params}\n` +
    `-->\n`
  );
}
