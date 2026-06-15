import type { WordTiming } from "./props.js";

// Aggregate ElevenLabs per-character alignment into word timings. Whitespace separates words;
// a word's span runs from its first character's start to its last character's end.
export function charsToWords(chars: string[], starts: number[], ends: number[]): WordTiming[] {
  const words: WordTiming[] = [];
  let cur = "";
  let curStart = 0;
  let started = false;
  for (let i = 0; i < chars.length; i++) {
    if (/\s/.test(chars[i])) {
      if (started) {
        words.push({ word: cur, start: curStart, end: ends[i - 1] });
        cur = "";
        started = false;
      }
    } else {
      if (!started) {
        curStart = starts[i];
        started = true;
      }
      cur += chars[i];
    }
  }
  if (started) words.push({ word: cur, start: curStart, end: ends[ends.length - 1] });
  return words;
}

// Index of the word currently (or most recently) being spoken at time t — lingers on the last
// started word through gaps and after the end, so highlights don't flicker. -1 before the first.
export function activeWordIndex(words: WordTiming[], t: number): number {
  let idx = -1;
  for (let i = 0; i < words.length; i++) {
    if (words[i].start <= t) idx = i;
    else break;
  }
  return idx;
}

// Shift clip-relative word timings onto the main timeline.
export function offsetWords(words: WordTiming[], dt: number): WordTiming[] {
  return words.map((w) => ({ word: w.word, start: w.start + dt, end: w.end + dt }));
}
