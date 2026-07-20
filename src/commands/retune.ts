// Rewrite beat-relative motion triggers (and optional backgroundTriggers) from real VO word
// timings — the post-build step for speech-synced UIs. Heuristic matches build-pipeline.js:
// trigger[i] ← start of word at index (words.length - triggers.length + i).
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { prepare } from "./build.js";
import { SpecSchema, type Spec } from "../spec/schema.js";
import type { WordTiming } from "../render/props.js";
import { log } from "../log.js";

export type Trigger = { at: number; action: string };

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Map triggers onto the last N spoken words (starts). Pure — unit-tested. */
export function retuneTriggers(words: WordTiming[], triggers: Trigger[]): { next: Trigger[]; changes: string[] } {
  if (!triggers.length) return { next: triggers, changes: [] };
  if (words.length < triggers.length) {
    return {
      next: triggers,
      changes: [`need ${triggers.length} words, have ${words.length} — left unchanged`],
    };
  }
  const next = triggers.map((t, i) => {
    const w = words[words.length - triggers.length + i];
    return { ...t, at: round3(w.start) };
  });
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
  const working = SpecSchema.parse(JSON.parse(readFileSync(absPath, "utf8"))) as Spec;

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
