// Pure ffmpeg filter-chain construction for the native audio mix. Split out of audioMix.ts so the
// exact strings can be unit-tested without spawning ffmpeg — the mix itself is one execa call and
// there is nothing to assert about it except the graph it was handed.
//
// THE RULE THIS FILE EXISTS TO ENFORCE: at their defaults (`pan` 0, `rate` 1, `voVolume` 1) the
// chains must be BYTE-IDENTICAL to what kino emitted before those knobs existed. Every already-
// shipped spec has to keep rendering the same audio, sample for sample. So the defaults emit no
// filter at all — a centre pan is not "normalized" into a gain that happens to be 1, it is absent.

export const RATE = 44100;

/** Every input is forced to one format before anything else touches it, so amix never has to. */
export const UNIFORM = "aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo";

/** Shortest exact-ish decimal for a filter argument — keeps the graph string deterministic. */
function num(n: number): string {
  return String(Math.round(n * 1e6) / 1e6);
}

/**
 * Constant-power stereo gains for a pan position, **unity at centre**.
 *
 * The textbook law is `cos θ, sin θ` with `θ = (pan+1)·π/4`, which puts centre at 0.707 — i.e.
 * −3 dB. That would make `pan: 0.001` audibly quieter than `pan: 0`, since 0 emits no filter at
 * all, and an author sweeping a sound across the field would hear a step exactly at the middle.
 * Scaling the whole law by √2 removes the step: centre is 1/1, the sum of squares stays constant
 * (at 2, the power a stereo pair already had), and a hard pan is +3 dB in the channel it lands in.
 * That boost is the price of constant power; it is also the thing most likely to clip a busy mix
 * (`amix` sums, see audioMix.ts), so hard pans want a lower `volume`.
 */
export function panGains(pan: number): { left: number; right: number } {
  const theta = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4;
  return { left: Math.SQRT2 * Math.cos(theta), right: Math.SQRT2 * Math.sin(theta) };
}

export interface SfxFilterEvent {
  at: number; // absolute seconds on the main timeline
  volume: number;
  pan?: number;
  rate?: number;
  /** Fade the head of the EVENT over this many seconds (source-timeline; scales with rate). */
  fadeInSec?: number;
  /** Fade the tail of the EVENT over this many seconds (source-timeline; scales with rate). */
  fadeOutSec?: number;
}

/**
 * The filter chain for one sfx event: `[<idx>:a]…[<label>]`.
 *
 * Filter ORDER is load-bearing. `asetrate` reinterprets the stream at a new sample rate, which
 * retimes everything already in the chain — running it after `adelay` would divide the delay by
 * `rate` and the event would land somewhere other than `at`. So the varispeed pair comes first,
 * `aresample` puts the clock back to 44.1k, and only then does `adelay` place the event. Gain and
 * pan are scalar and ride at the end where they cannot move anything in time.
 */
export function sfxFilterChain(s: SfxFilterEvent, inputIdx: number, label: string): string {
  const ms = Math.round(s.at * 1000);
  const parts = [UNIFORM];
  // Varispeed, not time-stretch: pitch and duration move together. On a 100 ms transient a
  // semitone costs ~6% of its length, which nobody hears; on anything with a tune in it, this is
  // the wrong tool.
  if (s.rate != null && s.rate !== 1) parts.push(`asetrate=${Math.round(RATE * s.rate)}`, `aresample=${RATE}`);
  // Fades ride the EVENT, before adelay places it. Fade-in is afade from the source's own start
  // (st=0 — the event's head). Fade-out is the areverse trick: reverse, fade in the first
  // fadeOutSec of the reversed stream (= the LAST fadeOutSec of the original), reverse back.
  // That avoids needing the source duration, which the pure chain builder cannot know. Both sit
  // AFTER the varispeed pair, so their seconds are the PLAYED event's seconds — a fade scales
  // with `rate` exactly like the event does, and the reversed stream keeps the same clock
  // (areverse preserves sample rate; afade on it is time-based, so the reversed fade's seconds
  // are the original's).
  if (s.fadeInSec != null && s.fadeInSec > 0) parts.push(`afade=t=in:st=0:d=${num(s.fadeInSec)}`);
  if (s.fadeOutSec != null && s.fadeOutSec > 0) parts.push(`areverse,afade=t=in:st=0:d=${num(s.fadeOutSec)},areverse`);
  parts.push(`adelay=${ms}|${ms}`, `volume=${s.volume}`);
  if (s.pan != null && s.pan !== 0) {
    const { left, right } = panGains(s.pan);
    // Scale the source's own channels rather than downmixing — a stereo effect keeps its image.
    parts.push(`pan=stereo|c0=${num(left)}*c0|c1=${num(right)}*c1`);
  }
  return `[${inputIdx}:a]${parts.join(",")}[${label}]`;
}

/** The VO chain: uniform format, plus `voVolume` when it is not the identity. */
export function voFilterChain(inputIdx: number, label: string, voVolume?: number): string {
  const gain = voVolume != null && voVolume !== 1 ? `,volume=${num(voVolume)}` : "";
  return `[${inputIdx}:a]${UNIFORM}${gain}[${label}]`;
}
