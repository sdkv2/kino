// Rewrite beat-relative motion triggers (and optional backgroundTriggers) from real VO word
// timings — the post-build step for speech-synced UIs.
//
// Heuristic (content words only when enough exist):
//   1. content.length === N → use those in order (exact step list)
//   2. else if existing triggers cluster in the first half of the spoken span → first N
//   3. else → last N (pipeline: "… Voiceover, motion, render, mp4.")
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { prepare } from "./build.js";
import { parseSpec, type Spec } from "../spec/schema.js";
import type { WordTiming } from "../render/props.js";
import { log } from "../log.js";

export type Trigger = { at: number; action: string };

const STOP = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "be",
  "but",
  "by",
  "do",
  "for",
  "from",
  "had",
  "has",
  "have",
  "if",
  "in",
  "is",
  "it",
  "its",
  "just",
  "me",
  "my",
  "not",
  "of",
  "on",
  "or",
  "so",
  "still",
  "that",
  "the",
  "them",
  "these",
  "they",
  "this",
  "those",
  "to",
  "was",
  "we",
  "were",
  "with",
  "you",
  "your",
]);

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function isContent(word: string): boolean {
  const n = word.replace(/[^a-zA-Z0-9']/g, "").toLowerCase();
  return n.length > 0 && !STOP.has(n);
}

/** Map triggers onto spoken step nouns. Pure — unit-tested. */
export function retuneTriggers(words: WordTiming[], triggers: Trigger[]): { next: Trigger[]; changes: string[] } {
  if (!triggers.length) return { next: triggers, changes: [] };
  if (words.length < triggers.length) {
    return {
      next: triggers,
      changes: [`need ${triggers.length} words, have ${words.length} — left unchanged`],
    };
  }
  const n = triggers.length;
  const content = words.filter((w) => isContent(w.word));
  const pool = content.length >= n ? content : words;

  let picked: WordTiming[];
  if (content.length === n) {
    picked = content;
  } else {
    const t0 = words[0].start;
    const t1 = words[words.length - 1].end;
    const mid = t0 + (t1 - t0) / 2;
    const avgAt = triggers.reduce((s, t) => s + t.at, 0) / n;
    picked = avgAt <= mid ? pool.slice(0, n) : pool.slice(-n);
  }

  const next = triggers.map((t, i) => ({ ...t, at: round3(picked[i].start) }));
  const changes: string[] = [];
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].at !== next[i].at) {
      changes.push(`[${i}].at: ${triggers[i].at} → ${next[i].at}`);
    }
  }
  return { next, changes };
}

export async function retune(
  specPath: string,
  opts: { dryRun?: boolean; project?: string } = {},
): Promise<void> {
  const absPath = resolve(specPath);
  const working = parseSpec(JSON.parse(readFileSync(absPath, "utf8"))) as Spec;

  log.step("retune (real VO)");
  const { props, words: segWords } = await prepare(absPath, { mock: false, project: opts.project });

  const logLines: string[] = [];
  const absWords: WordTiming[] = [];

  working.segments.forEach((seg, i) => {
    const startSec = props.segments[i]?.startSec ?? 0;
    const abs = segWords[i] ?? [];
    for (const w of abs) absWords.push(w);
    const beatRel = abs.map((w) => ({
      word: w.word,
      start: w.start - startSec,
      end: w.end - startSec,
    }));

    if (seg.kind !== "motion" || !seg.triggers?.length) return;
    const { next, changes } = retuneTriggers(beatRel, seg.triggers);
    if (changes.some((c) => c.includes("need"))) {
      logLines.push(`segment[${i}]: ${changes[0]}`);
      return;
    }
    if (!changes.length) {
      logLines.push(`segment[${i}].triggers: unchanged`);
      return;
    }
    seg.triggers = next;
    for (const c of changes) logLines.push(`segment[${i}].triggers${c}`);
  });

  if (working.backgroundTriggers?.length) {
    const { next, changes } = retuneTriggers(absWords, working.backgroundTriggers);
    if (changes.some((c) => c.includes("need"))) {
      logLines.push(`backgroundTriggers: ${changes[0]}`);
    } else if (!changes.length) {
      logLines.push("backgroundTriggers: unchanged");
    } else {
      working.backgroundTriggers = next;
      for (const c of changes) logLines.push(`backgroundTriggers${c}`);
    }
  }

  if (!logLines.length) log.ok("nothing to retune (no triggers)");
  for (const line of logLines) log.ok(line);

  if (opts.dryRun) {
    log.warn("dry-run — spec not written");
    return;
  }

  writeFileSync(absPath, JSON.stringify(working, null, 2) + "\n");
  log.ok(`wrote ${absPath}`);
}
