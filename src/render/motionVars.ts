import type { Theme, BgParamValue, WordTiming } from "./props.js";
import { progressCurves } from "./bgparams.js";

export interface MotionVarDynamics {
  frame: number;
  t: number;
  progress: number;
  pulse: number;
  params: Record<string, BgParamValue>;
  captionBottom?: number; // px from frame bottom where the caption band sits (0 = no caption this beat)
  wordsShown?: number; // spoken words whose start has been reached at this frame (0 when no VO words)
  wordCount?: number; // total spoken words in this beat (0 when no VO words)
}

/** Rebase absolute-timeline VO word spans to beat-relative (env.t / --progress are beat-relative,
 *  so a motion graphic compares its own clock to these directly). Returns undefined for no words
 *  so the optional prop simply stays absent. */
export function beatRelativeWords(words: WordTiming[] | undefined, startSec: number): WordTiming[] | undefined {
  if (!words || words.length === 0) return undefined;
  return words.map((w) => ({ word: w.word, start: w.start - startSec, end: w.end - startSec }));
}

/** Continuous count of the beat's spoken words shown by beat-relative time `t` (seconds): each
 *  word contributes its elapsed fraction (0→1 across its spoken span), so word-gated reveals like
 *  clamp(0, calc(var(--kino-words-shown) - i), 1) ease through the word instead of stepping at its
 *  start (the "weird lag" on gated lines). Reaches exactly k when word k finishes; zero-length
 *  spans count as fully shown at their start. Words are beat-relative. */
export function wordsShownAt(words: WordTiming[] | undefined, t: number): number {
  if (!words) return 0;
  let n = 0;
  for (const w of words) {
    if (t < w.start) continue;
    const span = w.end - w.start;
    n += span <= 0 ? 1 : Math.min(1, (t - w.start) / span);
  }
  return n;
}

/** Normalize a spoken word for atWord matching: lowercase, letters+digits only. */
const wordKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Resolve word-anchored timing entries ({ atWord: "match" } or { atWord: 2 }) to concrete
 * beat-relative `at` seconds from the beat's VO word spans — so triggers/keyframes ride the real
 * TTS timing instead of hand-copied numbers that drift between mock and real VO. Text matches the
 * first occurrence, case/punctuation-insensitive; numbers are word indices. Plain `at` entries pass
 * through untouched. Throws (naming the beat's words) on a miss so typos fail at validate, not on
 * screen.
 */
export function resolveWordAnchors<T extends { at?: number; atWord?: string | number }>(
  track: T[] | undefined,
  words: WordTiming[] | undefined,
  where: string,
): (Omit<T, "at" | "atWord"> & { at: number })[] | undefined {
  if (!track) return undefined;
  return track.map((entry) => {
    const { atWord, at, ...rest } = entry;
    if (atWord == null) {
      if (at == null) throw new Error(`${where}: set exactly one of at / atWord`);
      return { ...rest, at } as Omit<T, "at" | "atWord"> & { at: number };
    }
    if (!words || words.length === 0) throw new Error(`${where}: atWord needs spoken words, but this beat has no spoken words`);
    let hit: WordTiming | undefined;
    if (typeof atWord === "number") {
      hit = words[atWord];
      if (!hit) throw new Error(`${where}: atWord ${atWord} out of range (beat has ${words.length} words)`);
    } else {
      hit = words.find((w) => wordKey(w.word) === wordKey(atWord));
      if (!hit) {
        throw new Error(`${where}: atWord "${atWord}" is not spoken in this beat — words: ${words.map((w) => w.word).join(" ")}`);
      }
    }
    return { ...rest, at: Math.round(hit.start * 1000) / 1000 } as Omit<T, "at" | "atWord"> & { at: number };
  });
}

// Build the CSS custom properties set on a motion-graphic host every frame. The agent's shadow-scoped
// CSS reads these (they inherit across the shadow boundary): the frame-driven vars, every resolved
// spec param as --<key>, and the brand palette. Pure so it's unit-testable.
//   NOTE: --kino-gold MUST be here — omitting gold silently renders any gold-referencing declaration
//   invalid (invisible, no error).
export function buildMotionVars(t: Theme, dyn: MotionVarDynamics): Record<string, string> {
  const curves = progressCurves(dyn.progress);
  const vars: Record<string, string> = {
    "--frame": String(dyn.frame),
    "--t": dyn.t.toFixed(4),
    "--progress": dyn.progress.toFixed(4),
    // Eased progress (same curves as keyframe ease). Prefer these over linear --progress for
    // entrances/camera. overshoot/spring may briefly exceed 1 — fine for scale; clamp for opacity.
    "--kino-out": curves.out.toFixed(4),
    "--kino-inout": curves.inout.toFixed(4),
    "--kino-overshoot": curves.overshoot.toFixed(4),
    "--kino-spring": curves.spring.toFixed(4),
    // 0 at beat edges, 1 mid-beat — seam-safe wash/breath (sin(progress·π)).
    "--kino-edge": curves.edge.toFixed(4),
    "--pulse": dyn.pulse.toFixed(4),
    "--kino-green": t.green,
    "--kino-night": t.night,
    "--kino-white": t.white,
    "--kino-mint": t.mint,
    "--kino-gold": t.gold,
    "--kino-font": t.font,
    // Second typeface for label/mono-style text inside a motion beat, distinct from the caption
    // font — falls back to --kino-font so it's never invalid when the brand sets no labelFont.
    "--kino-label-font": t.labelFont ?? t.font,
    // The caption band bottom (px from frame bottom; 0 when this beat has no caption) so authors can
    // position their own text clear of kino's auto caption, e.g. bottom: calc(var(--kino-caption-bottom) + 24px).
    "--kino-caption-bottom": `${dyn.captionBottom ?? 0}px`,
    // Spoken-word progress, so a stylised graphic can type text in sync with the VO without
    // hand-placed keyframes: reveal the first --kino-words-shown of --kino-word-count words.
    // Continuous (fraction into the current word's span) — 3dp keeps integer values printing bare.
    "--kino-words-shown": String(Math.round((dyn.wordsShown ?? 0) * 1000) / 1000),
    "--kino-word-count": String(dyn.wordCount ?? 0),
  };
  for (const [k, v] of Object.entries(dyn.params)) vars[`--${k}`] = String(v);
  return vars;
}
