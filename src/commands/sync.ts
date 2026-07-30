// `kino sync <spec>` — retime the spec's visual beats so every cut lands on the music's
// beat grid. Detection + quantization live in media/beats.ts (pure, unit-tested); this
// command resolves the timeline the same way retune does (prepare()), fits the grid over
// the stretch of music the video actually plays, and writes the new durations (and, with
// --offset auto, a `music.startSec`) back into the spec.
//
// VO-driven beats keep their spoken length — sync leaves them alone and re-anchors the
// timeline at the next visual beat. Run sync AFTER the real VO exists when the spec
// speaks (same rule as retune); all-visual specs sync for free.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { prepare } from "./build.js";
import { loadSpec } from "../spec/schema.js";
import { resolveAudioSource } from "../media/sfx.js";
import { decodePcm } from "../media/markers.js";
import { detectBeatGrid, pickLoudestGridStart, solveCutDurations, type BeatGrid } from "../media/beats.js";
import { GAP } from "../vo/gap.js";
import { log } from "../log.js";

const ANALYSIS_RATE = 16000;
const WEAK_GRID = 0.5;
const WINDOW_PAD_SEC = 1.5; // analyze slightly past the video end so the last bar is covered

export interface SyncOpts {
  project?: string;
  grain?: "beat" | "bar";
  offset?: "auto" | "keep";
  minDur?: number;
  dryRun?: boolean;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export async function sync(specPath: string, opts: SyncOpts = {}): Promise<void> {
  const absPath = resolve(specPath);
  const working = loadSpec(absPath);
  if (!working.music) throw new Error("spec has no music — `kino sync` retimes cuts against the music bed (add `music.src` first)");

  const grainBeats = (opts.grain ?? "bar") === "bar" ? 4 : 1;
  const spoken = working.segments.some((s) => s.text || s.voFile);

  // Resolve the real timeline. Spoken specs need the actual VO lengths (mock paces lie),
  // which prepare() serves from the content-hash cache — free after the first real build.
  log.step(`sync (${spoken ? "real VO timeline" : "visual timeline"})`);
  const { props, project, spec } = await prepare(absPath, { mock: !spoken, project: opts.project });
  const segs = props.segments;
  const total = segs[segs.length - 1].endSec;

  // Per-beat lengths excluding the inter-beat gap; editable = the beat's length is an
  // authored `dur`, not a VO recording.
  const timeline = segs.map((ps, i) => {
    const rawLen = i < segs.length - 1 ? segs[i + 1].startSec - ps.startSec - GAP : ps.endSec - ps.startSec;
    const sSeg = spec.segments[i];
    return { durSec: rawLen, editable: sSeg.dur != null && !sSeg.text && !sSeg.voFile };
  });
  if (!timeline.some((t) => t.editable)) throw new Error("no visual beats with an authored `dur` — nothing sync can retime");

  const musicAbs = resolveAudioSource(spec.music!.src, project);
  const samples = await decodePcm(musicAbs, ANALYSIS_RATE);
  const musicSec = samples.length / ANALYSIS_RATE;

  // Choose the playback offset, then fit the grid LOCALLY over the window that will play —
  // real tracks drift, so a whole-file fit is only good enough to enumerate candidates.
  let startSec = spec.music!.startSec;
  if (opts.offset === "auto") {
    const coarse = detectBeatGrid(samples, ANALYSIS_RATE);
    if (!coarse) throw new Error("no beat grid detected in the music — pick a more percussive track");
    startSec = pickLoudestGridStart(samples, ANALYSIS_RATE, coarse, Math.min(total + WINDOW_PAD_SEC, musicSec));
  }
  let grid: BeatGrid | null = detectBeatGrid(samples, ANALYSIS_RATE, {
    windowStartSec: startSec,
    windowEndSec: Math.min(startSec + total + WINDOW_PAD_SEC, musicSec),
  });
  if (!grid) throw new Error("no beat grid detected in the playback window — pick a more percussive track or another startSec");
  if (opts.offset === "auto" && grid.phaseSec > startSec + 0.005) {
    // The whole-file fit drifts against the local one; phaseSec is the first LOCAL beat at or
    // after the candidate start — snap to it so the video opens exactly on a hit.
    startSec = grid.phaseSec;
    grid = detectBeatGrid(samples, ANALYSIS_RATE, {
      windowStartSec: startSec,
      windowEndSec: Math.min(startSec + total + WINDOW_PAD_SEC, musicSec),
    }) ?? grid;
  }
  if (musicSec - startSec < total) {
    log.warn(`music has ${r3(musicSec - startSec)}s after startSec=${r3(startSec)} but the video runs ${r3(total)}s — the bed ends early`);
  }
  if (grid.strength < WEAK_GRID) {
    log.warn(`beat grid is weak (strength ${grid.strength}) — the sync may not read; consider a track with a steadier pulse`);
  }
  // Grid phase in video time: first beat at/after the playback start.
  const rel = (((grid.phaseSec - startSec) % grid.periodSec) + grid.periodSec) % grid.periodSec;

  const { durs, cuts } = solveCutDurations({
    segments: timeline,
    gapSec: GAP,
    periodSec: grid.periodSec,
    phaseSec: rel,
    grainBeats,
    minDurSec: opts.minDur,
  });

  log.info(`grid: ${grid.bpm} bpm · ${grainBeats === 4 ? "bar" : "beat"} = ${r3(grid.periodSec * grainBeats)}s · strength ${grid.strength}`);
  if (opts.offset === "auto") log.info(`music.startSec: ${spec.music!.startSec} → ${r3(startSec)} (loudest on-grid window)`);

  let changed = 0;
  working.segments.forEach((seg, i) => {
    if (!timeline[i].editable) {
      log.info(`segment[${i}]: VO beat — dur untouched`);
      return;
    }
    const next = r3(durs[i]);
    if (seg.dur !== next) {
      log.ok(`segment[${i}].dur: ${seg.dur} → ${next}`);
      seg.dur = next;
      changed++;
    } else {
      log.info(`segment[${i}].dur: ${seg.dur} (already on grid)`);
    }
  });
  for (const c of cuts) {
    const label = c.index === working.segments.length ? "end" : `cut ${c.index}`;
    if (!c.onGrid) log.warn(`${label} at ${c.afterSec}s is off grid (a VO beat sets it) — the next visual beat re-anchors`);
    else if (c.deltaMs !== 0) log.info(`${label}: ${c.beforeSec}s → ${c.afterSec}s (${c.deltaMs > 0 ? "+" : ""}${c.deltaMs}ms)`);
  }

  if (working.music!.startSec !== r3(startSec)) {
    working.music!.startSec = r3(startSec);
    changed++;
  }

  if (!changed) {
    log.ok("already in sync — nothing to write");
    return;
  }
  if (opts.dryRun) {
    log.warn("dry-run — spec not written");
    return;
  }
  writeFileSync(absPath, JSON.stringify(working, null, 2) + "\n");
  log.ok(`wrote ${absPath}`);
}
