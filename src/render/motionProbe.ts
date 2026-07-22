// Under-animation lint: sample a few frames across each full-screen motion beat and compare —
// near-identical probe frames mean the graphic is a poster with a dissolve, not motion (the #1
// authored-graphic failure). Pure frame math + verdict here; the build wires renderStills + the
// raw-RGB diff (media/seam) around it.
import type { KinoSegment } from "./props.js";

/** Beat-progress points to sample: past the entrance, mid-life, near settle. */
export const PROBE_POINTS = [0.2, 0.5, 0.9] as const;

/** Max mean channel Δ (0..255) under which a beat counts as barely animating. Deliberately low —
 *  a breathing wash clears it; only a genuinely frozen frame fails. */
export const UNDER_ANIMATED_MEAN = 0.35;

export interface ProbePick {
  segment: number;
  frames: number[];
}

/** Probe frames for every full-screen motion beat (overlays sit on moving footage — skipped). */
export function probeFramePicks(segments: KinoSegment[], fps: number): ProbePick[] {
  return segments.flatMap((s, i) => {
    if (s.kind !== "motion" || !s.motion) return [];
    const dur = s.endSec - s.startSec;
    return [{ segment: i, frames: PROBE_POINTS.map((p) => Math.round((s.startSec + p * dur) * fps)) }];
  });
}

/** True when every consecutive probe pair is visually near-identical. */
export function isUnderAnimated(pairMeanDiffs: number[]): boolean {
  if (!pairMeanDiffs.length) return false;
  return pairMeanDiffs.every((d) => d < UNDER_ANIMATED_MEAN);
}
