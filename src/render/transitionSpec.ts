// When are two beats on screen together, and how far through that overlap is this frame?
//
// Deliberately derived from the group spans layersAt already produces, NOT from a new
// authored transition window: that keeps every existing spec's timing byte-identical and
// confines shader transitions to frames that were already crossfading by opacity.
import type { KinoProps } from "./props.js";
import { motionHandoff, motionXfadeFrames, pickTransition, type Transition } from "./motion.js";
import { isWipe, resolveWipeParams, type WipeParams } from "./wipeSpec.js";
import { assembleTransitionSource, transitionParamNames, transitionColorNames, parseHexColor } from "./transitionSource.js";
import { hexToVec3 } from "./shaderSource.js";
import { resolveCamera, type CameraParams } from "./cameraSpec.js";

const CHAIN_HOLD_FRAMES = 12;

export interface GroupSpan {
  id: string;
  /** First frame the group is on screen. */
  from: number;
  /** One past the last frame the group is on screen. */
  to: number;
}

export interface TransitionWindow {
  from: string;
  to: string;
  /** 0 at the first overlapping frame, 1 at the last. */
  p: number;
}

export function transitionProgress(opts: { groups: GroupSpan[]; frame: number }): TransitionWindow | null {
  const { groups, frame } = opts;
  const sorted = [...groups].sort((a, b) => a.from - b.from);
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    const start = b.from;
    const end = a.to;
    if (end <= start) continue;              // no overlap — a hard cut, as today
    if (frame < start || frame > end) continue;
    const span = end - start;
    return { from: a.id, to: b.id, p: span === 0 ? 1 : (frame - start) / span };
  }
  return null;
}

/** Beat visibility spans — mirrors layersAt / KinoVideo sequence windows. */
export function groupSpans(props: KinoProps): GroupSpan[] {
  const f = (sec: number) => Math.round(sec * props.fps);
  return props.segments.map((s, i) => {
    const from = f(s.startSec);
    if (s.kind === "video") {
      const next = props.segments[i + 1];
      const chained = next?.kind === "video";
      const seqDur = chained ? f(next.startSec) - from + CHAIN_HOLD_FRAMES : f(s.endSec) - from;
      return { id: `beat${i}`, from, to: from + seqDur };
    }
    if (s.kind === "motion" && s.motion) {
      const prev = props.segments[i - 1];
      const next = props.segments[i + 1];
      const nextMotion = next?.kind === "motion" ? next : null;
      const h = motionHandoff({
        startSec: s.startSec,
        endSec: s.endSec,
        nextMotionStartSec: nextMotion ? nextMotion.startSec : null,
        prevIsMotion: prev?.kind === "motion",
        fps: props.fps,
        xfadeFrames: nextMotion ? motionXfadeFrames(nextMotion.transition) : 0,
        fadeIn: prev?.kind === "motion" && motionXfadeFrames(s.transition) > 0,
      });
      return { id: `beat${i}`, from: h.from, to: h.from + h.seqDur };
    }
    return { id: `beat${i}`, from, to: f(s.endSec) };
  });
}

/** Transition shader for the incoming beat in an overlap window. */
export function transitionKindForWindow(props: KinoProps, win: TransitionWindow): Transition {
  const idx = parseInt(win.to.slice(4), 10);
  const seg = props.segments[idx];
  if (!seg) return "fade";
  let appIdx = 0;
  for (let i = 0; i < idx; i++) {
    if (props.segments[i].kind === "video") appIdx++;
  }
  if (seg.kind === "video") {
    const isVideo = /\.(mp4|mov)$/i.test(seg.source ?? "");
    return pickTransition(appIdx, seg.transition as Transition | undefined, isVideo);
  }
  // Motion beats are NOT part of the app cut-in auto-vary. They used to fall through to
  // `pickTransition(0, …)`, which returns TRANSITIONS[0] — "fly-left" — so every motion→motion
  // handoff in every spec got a punchy horizontal slide, contradicting both the schema comment on
  // `transition` and docs/motion-graphics.md, which promise a dissolve. Worse, the index was
  // hard-coded to 0, so it wasn't even varying; it was one fixed slide everywhere. A motion beat
  // owns its whole frame, so shoving that frame sideways reads as the compositor mishandling the
  // cut rather than as an authored move. Dissolve is the documented default; anything else is opt-in.
  return (seg.transition as Transition | undefined) ?? "dissolve";
}

/**
 * Wipe uniforms for an overlap window, or `undefined` when the transition isn't a wipe.
 *
 * Read off the INCOMING beat, same as the kind — a transition belongs to the beat arriving, so a
 * beat can be reused in another cut without dragging its neighbour's handoff along.
 */
export function transitionWipeForWindow(props: KinoProps, win: TransitionWindow): WipeParams | undefined {
  const kind = transitionKindForWindow(props, win);
  if (!isWipe(kind)) return undefined;
  const seg = props.segments[parseInt(win.to.slice(4), 10)];
  return resolveWipeParams(kind, seg?.transitionParams, props.theme.accent);
}

/**
 * Assembled source + uniform values for an author-supplied transition, or `undefined` when the
 * window's transition is a built-in.
 *
 * Assembled here rather than at build time so the author's file stays exactly what they wrote — the
 * wrapper (uniform header, kinoFrom/kinoTo helpers, entry point) is regenerated from the params the
 * beat actually declares, which is what makes the `u_<name>` aliases line up with the slots.
 */
export function transitionCustomForWindow(
  props: KinoProps,
  win: TransitionWindow,
): { source: string; params: number[]; colors: Array<[number, number, number]>; brand: BrandPalette } | undefined {
  if (transitionKindForWindow(props, win) !== "custom") return undefined;
  const seg = props.segments[parseInt(win.to.slice(4), 10)];
  if (!seg?.transitionSource) return undefined;
  const declared = (seg.transitionParams ?? {}) as Record<string, number | string>;
  const names = transitionParamNames(declared);
  const colorNames = transitionColorNames(declared);
  return {
    source: assembleTransitionSource(seg.transitionSource, names, colorNames),
    params: names.map((n) => Number(declared[n]) || 0),
    colors: colorNames.map((n) => parseHexColor(String(declared[n]))!),
    brand: brandPalette(props.theme),
  };
}

/** The five palette roles as shader-ready rgb, so a custom transition can pigment itself with the
 *  brand instead of a hard-coded hue. Same source of truth as every other colour on the frame —
 *  a resolved `Theme`, which is DEFAULT_BRAND merged with the brand.md overrides. */
export interface BrandPalette {
  bg: [number, number, number];
  fg: [number, number, number];
  accent: [number, number, number];
  accent2: [number, number, number];
  deep: [number, number, number];
}

export function brandPalette(theme: KinoProps["theme"]): BrandPalette {
  return {
    bg: hexToVec3(theme.bg),
    fg: hexToVec3(theme.fg),
    accent: hexToVec3(theme.accent),
    accent2: hexToVec3(theme.accent2),
    deep: hexToVec3(theme.deep),
  };
}

/**
 * Whether this window's transition runs backwards. Read off the INCOMING beat, like the kind and
 * the params, so a beat carries its own arrival and can be re-cut without dragging a neighbour's.
 *
 * Applies to EVERY transition — built-in or author-supplied — because inversion is implemented in
 * the compositor (swap the two inputs, feed 1-p), not in any shader.
 */
export function transitionInvertForWindow(props: KinoProps, win: TransitionWindow): boolean {
  return props.segments[parseInt(win.to.slice(4), 10)]?.transitionInvert === true;
}

/**
 * Camera carried through this window, or `undefined` when the beat asks for none.
 *
 * Read off the INCOMING beat like everything else about the handoff, and applied inside the shared
 * `kinoFrom` / `kinoTo` helpers — so it composes with every transition, built-in or authored, and
 * with `transitionInvert`.
 */
export function transitionCameraForWindow(props: KinoProps, win: TransitionWindow): CameraParams | undefined {
  return resolveCamera(props.segments[parseInt(win.to.slice(4), 10)]?.transitionCamera);
}
