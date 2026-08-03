// Music-bed volume curve, applied per-sample by the native audio mix (render/native/audioMix).
// Ducks to `duck` while any VO span is active with 0.3s linear ramps, holds the authored bed level
// otherwise, and fades linearly to 0 over the final `fadeOutSec`. Pure — lives in compiled-land
// (like props.ts) so both the CLI and the bundled .tsx can import it.
//
// The bed level is not necessarily a constant: `keyframes` tween it over the timeline, with
// `volume` acting as the implicit t=0 keyframe (the same idiom motion params and effect keyframes
// use). Ducking is applied ON TOP of whatever the curve says, through the same Math.min as before —
// so a keyframe to 0 is a hard gate that ducking can never lift back up, and a duck inside a fade
// ramps toward the faded level rather than stepping back to the authored `volume`.
import { paramsAt, type Keyframe } from "./bgparams.js";

const RAMP_SEC = 0.3;

export interface MusicVolumeOpts {
  duckSpans: Array<{ from: number; to: number }>; // VO-active spans (per-segment timings)
  volume: number; // bed level (implicit t=0 keyframe when `keyframes` is set)
  duck: number; // level while VO speaks
  fadeInSec: number; // head fade (avoids a click on loop-audio starts)
  fadeOutSec: number;
  endSec: number; // video end (fade target)
  keyframes?: Keyframe[]; // hand-keyed bed level, `at` absolute on the main timeline
}

/** The authored bed level at `sec`, before ducking and before the head/tail fades. */
export function musicBedLevelAt(sec: number, { volume, keyframes }: Pick<MusicVolumeOpts, "volume" | "keyframes">): number {
  if (!keyframes?.length) return volume;
  const v = paramsAt({ volume }, keyframes, sec, { implicitBase: true }).volume;
  return typeof v === "number" ? v : volume;
}

export function musicVolumeAt(sec: number, opts: MusicVolumeOpts): number {
  const { duckSpans, duck, fadeInSec, fadeOutSec, endSec } = opts;
  // The duck target is relative to the level the bed is ACTUALLY at here, not the authored base:
  // a ramp that interpolated from `volume` would step whenever a VO span sat inside a fade.
  const volume = musicBedLevelAt(sec, opts);
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
