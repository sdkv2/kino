import type { Theme, BgParamValue, WordTiming } from "./props.js";

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

/** How many of the beat's spoken words have STARTED by beat-relative time `t` (seconds).
 *  Word-granular, matching the caption engine's per-word reveal — the signal a typed-in-sync
 *  motion graphic reads to know how much of the prompt to show. Words are beat-relative. */
export function wordsShownAt(words: WordTiming[] | undefined, t: number): number {
  if (!words) return 0;
  let n = 0;
  for (const w of words) if (w.start <= t) n++;
  return n;
}

// Build the CSS custom properties set on a motion-graphic host every frame. The agent's shadow-scoped
// CSS reads these (they inherit across the shadow boundary): the frame-driven vars, every resolved
// spec param as --<key>, and the brand palette. Pure so it's unit-testable.
//   NOTE: --kino-gold MUST be here — omitting gold silently renders any gold-referencing declaration
//   invalid (invisible, no error).
export function buildMotionVars(t: Theme, dyn: MotionVarDynamics): Record<string, string> {
  const vars: Record<string, string> = {
    "--frame": String(dyn.frame),
    "--t": dyn.t.toFixed(4),
    "--progress": dyn.progress.toFixed(4),
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
    "--kino-words-shown": String(dyn.wordsShown ?? 0),
    "--kino-word-count": String(dyn.wordCount ?? 0),
  };
  for (const [k, v] of Object.entries(dyn.params)) vars[`--${k}`] = String(v);
  return vars;
}
