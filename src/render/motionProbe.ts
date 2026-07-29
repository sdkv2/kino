// Under-animation lint: sample a few frames across each full-screen motion beat and compare —
// near-identical probe frames mean the graphic is a poster with a dissolve, not motion (the #1
// authored-graphic failure). Pure frame math + verdict here; the build wires renderStills + the
// raw-RGB diff (media/seam) around it.
import type { KinoSegment } from "./props.js";

/** Beat-progress points to sample. Three points meant a beat that changed once between 0.2 and 0.5
 *  and then froze for the rest of its life still passed; five catch a stall in any third. */
export const PROBE_POINTS = [0.1, 0.3, 0.5, 0.7, 0.9] as const;

/** Max mean channel Δ (0..255) under which a beat counts as barely animating. Deliberately low —
 *  a breathing wash clears it; only a genuinely frozen frame fails. */
export const UNDER_ANIMATED_MEAN = 0.35;

/** Grid the subject test tiles each probe pair over. */
export const SUBJECT_TILE_GRID = { cols: 8, rows: 8 } as const;

/** Min per-tile mean channel Δ for a tile to count as carrying real movement. A full-frame gradient
 *  wash lands every tile well under this; a moving glyph, card or prop pushes its own tiles far past
 *  it. See `tileDiffs` for why the frame-wide mean cannot make this call. */
export const SUBJECT_TILE_MEAN = 1.2;

/**
 * True when no probe pair has a single tile carrying real movement — the beat animates *something*
 * (so `isUnderAnimated` clears it) but only diffusely: a drifting glow or a crossfading wash behind
 * a subject that never moves.
 *
 * This is the failure the frame-wide mean is structurally blind to, and it was the most common
 * authored-graphic defect in practice: a beat whose background breathes reads as "animating" to a
 * mean-diff check while the thing the viewer is looking at sits still.
 *
 * `pairTileDiffs` is one tile array per consecutive probe pair.
 */
export function isSubjectStatic(pairTileDiffs: number[][]): boolean {
  const pairs = pairTileDiffs.filter((t) => t.length);
  if (!pairs.length) return false;
  return pairs.every((tiles) => Math.max(...tiles) < SUBJECT_TILE_MEAN);
}

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
