// Music-bed volume curve, evaluated per frame by the Remotion <Audio> volume callback.
// Ducks to `duck` while any VO span is active with 0.3s linear ramps, holds `volume`
// otherwise, and fades linearly to 0 over the final `fadeOutSec`. Pure — lives in
// compiled-land (like props.ts) so both the CLI and the bundled .tsx can import it.

const RAMP_SEC = 0.3;

export interface MusicVolumeOpts {
  duckSpans: Array<{ from: number; to: number }>; // VO-active spans (per-segment timings)
  volume: number; // bed level
  duck: number; // level while VO speaks
  fadeInSec: number; // head fade (avoids a click on loop-audio starts)
  fadeOutSec: number;
  endSec: number; // video end (fade target)
}

export function musicVolumeAt(sec: number, { duckSpans, volume, duck, fadeInSec, fadeOutSec, endSec }: MusicVolumeOpts): number {
  // Per span, compute the ducked level implied by proximity; overlapping ramps take the minimum
  // (most ducked) so back-to-back spans never pop the bed up in a short gap.
  let level = volume;
  for (const s of duckSpans) {
    let l: number;
    if (sec >= s.from && sec <= s.to) l = duck;
    else if (sec >= s.from - RAMP_SEC && sec < s.from) l = duck + (volume - duck) * ((s.from - sec) / RAMP_SEC);
    else if (sec > s.to && sec <= s.to + RAMP_SEC) l = duck + (volume - duck) * ((sec - s.to) / RAMP_SEC);
    else continue;
    level = Math.min(level, l);
  }
  // Head fade in from silence.
  if (fadeInSec > 0 && sec < fadeInSec) level *= sec / fadeInSec;
  // Tail fade to silence.
  if (sec >= endSec) return 0;
  if (fadeOutSec > 0 && sec > endSec - fadeOutSec) level *= (endSec - sec) / fadeOutSec;
  return Math.max(0, level);
}
