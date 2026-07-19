// Pure helpers for app cut-in source footage: clip windows, speed, and freeze points.
// Used by AppCutaway (Remotion) and unit-tested without a render.

/** Composition frame at which to freeze the media timeline, or null if still playing. */
export function appFreezeFrame(opts: {
  localFrame: number;
  fps: number;
  pauseAt?: number;
  clipFrom?: number;
  clipTo?: number;
  speed: number;
}): number | null {
  const { localFrame, fps, pauseAt, clipFrom = 0, clipTo, speed } = opts;
  const candidates: number[] = [];
  if (pauseAt != null) {
    const pauseFrame = Math.round(pauseAt * fps);
    if (localFrame >= pauseFrame) candidates.push(pauseFrame);
  }
  // When clipTo is set, hold the last playable composition frame once the window is consumed.
  if (clipTo != null && speed > 0) {
    const sourceFrames = Math.max(0, Math.round(clipTo * fps) - Math.round(clipFrom * fps));
    const endHold = Math.max(0, Math.floor(sourceFrames / speed) - 1);
    if (localFrame >= endHold) candidates.push(endHold);
  }
  if (!candidates.length) return null;
  return Math.min(...candidates);
}

/**
 * Remotion `<OffthreadVideo trimAfter>` wraps a Sequence whose `durationInFrames` is the
 * source `trimAfter` index — it does **not** stretch for `playbackRate`. Slow-mo (`speed<1`)
 * or a VO longer than the window then unmounts the video early (empty inset / black hole).
 *
 * So we only apply `trimBefore` (start offset). `clipTo` / `pauseAt` are enforced by
 * `appFreezeFrame` holding the last good composition frame for the rest of the beat.
 */
export function appTrimFrames(
  fps: number,
  clipFrom?: number,
  _clipTo?: number,
): { trimBefore: number; trimAfter: undefined } {
  const trimBefore = Math.round((clipFrom ?? 0) * fps);
  return { trimBefore, trimAfter: undefined };
}
