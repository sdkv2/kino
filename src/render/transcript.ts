import type { WordTiming } from "./props.js";

export interface TranscriptSegment { text: string; start: number; end: number; words: WordTiming[] }
export interface Transcript {
  text: string;
  durationSec: number;
  language?: string;
  words: WordTiming[];
  segments: TranscriptSegment[];
}

// Group flat word timings into lines: break after sentence-ending punctuation, or on a pause
// (gap from the previous word's end to this word's start) longer than maxGapSec.
export function groupWordsIntoSegments(words: WordTiming[], opts: { maxGapSec?: number } = {}): TranscriptSegment[] {
  const maxGap = opts.maxGapSec ?? 0.6;
  const segs: TranscriptSegment[] = [];
  let cur: WordTiming[] = [];
  const flush = () => {
    if (!cur.length) return;
    segs.push({ text: cur.map((w) => w.word).join(" "), start: cur[0].start, end: cur[cur.length - 1].end, words: cur });
    cur = [];
  };
  for (const w of words) {
    if (cur.length && w.start - cur[cur.length - 1].end > maxGap) flush();
    cur.push(w);
    if (/[.!?]$/.test(w.word)) flush();
  }
  flush();
  return segs;
}

const pad = (n: number, len = 2) => String(n).padStart(len, "0");

// HH:MM:SS<sep>mmm — sep is "," for SRT, "." for VTT. Floor millis (no rollover).
export function fmtTimecode(sec: number, msSep: "," | "."): string {
  const ms = Math.floor((sec % 1) * 1000);
  const s = Math.floor(sec) % 60;
  const m = Math.floor(sec / 60) % 60;
  const h = Math.floor(sec / 3600);
  return `${pad(h)}:${pad(m)}:${pad(s)}${msSep}${pad(ms, 3)}`;
}

export function buildTranscript(
  words: WordTiming[],
  opts: { durationSec: number; language?: string; fullText?: string; maxGapSec?: number },
): Transcript {
  const segments = groupWordsIntoSegments(words, { maxGapSec: opts.maxGapSec });
  return {
    text: opts.fullText ?? words.map((w) => w.word).join(" "),
    durationSec: opts.durationSec,
    language: opts.language,
    words,
    segments,
  };
}

export function wordsToSrt(segments: TranscriptSegment[]): string {
  return segments
    .map((s, i) => `${i + 1}\n${fmtTimecode(s.start, ",")} --> ${fmtTimecode(s.end, ",")}\n${s.text}`)
    .join("\n\n") + "\n";
}

export function wordsToVtt(segments: TranscriptSegment[]): string {
  return "WEBVTT\n\n" + segments
    .map((s) => `${fmtTimecode(s.start, ".")} --> ${fmtTimecode(s.end, ".")}\n${s.text}`)
    .join("\n\n") + "\n";
}

export function wordsToText(segments: TranscriptSegment[]): string {
  return segments.map((s) => s.text).join("\n") + "\n";
}
