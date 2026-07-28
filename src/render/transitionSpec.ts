// When are two beats on screen together, and how far through that overlap is this frame?
//
// Deliberately derived from the group spans layersAt already produces, NOT from a new
// authored transition window: that keeps every existing spec's timing byte-identical and
// confines shader transitions to frames that were already crossfading by opacity.
import type { KinoProps } from "./props.js";
import { motionHandoff, motionXfadeFrames, pickTransition, type Transition } from "./motion.js";

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
  return pickTransition(0, seg.transition as Transition | undefined, false);
}
