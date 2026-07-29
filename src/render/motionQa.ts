// Authored-graphic QA pass: render a handful of probe frames per motion beat, measure them, and
// report what a still cannot tell you by eye.
//
// This exists because the checks were previously wired into `build` only, as a warning that "never
// fails the build". Agents authoring motion iterate with `kino still` and `kino storyboard` — so the
// one automated check kino had for authored graphics ran on a command the author never invoked, and a
// 37-beat review found six beats shipped visibly frozen and one shipped with its entire signature
// effect invisible. Feedback that arrives after the work is finished is not feedback.
//
// Two verdicts, deliberately different in kind:
//   · under-animated — no probe pair differs at all. A poster with a dissolve.
//   · subject-static — pairs differ, but no single tile carries real movement: a drifting glow or a
//     crossfading wash behind a subject that never moves. Invisible to a frame-wide mean.
// Plus per-frame descriptors (colour/luma/chroma) so a claim like "the colour smears render" is
// checkable rather than assertable.
//
// Heuristics warn; they do not fail. A beat that holds still on purpose is a legitimate choice, and
// the provable defects (a clamp pinned to a constant) are rejected by the source lint instead —
// see motionLint.ts. This pass reports; motionLint.ts refuses.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { releaseScratch, scratchDir } from "../scratch.js";
import { decodeRgbAt } from "../media/loopSeam.js";
import { frameStats, seamDiff, tileDiffs, type FrameStats } from "../media/seam.js";
import { log } from "../log.js";
import type { KinoProps } from "./props.js";
import type { FormatId } from "./formats.js";
import { renderStills, type QualityPreset } from "./render.js";
import {
  isSubjectStatic,
  isUnderAnimated,
  probeFramePicks,
  SUBJECT_TILE_GRID,
  SUBJECT_TILE_MEAN,
} from "./motionProbe.js";

/** Fixed QA raster. 16:9-ish and small — tiles stay meaningful, cost stays constant across formats. */
const QA_W = 256;
const QA_H = 144;

/** Peak chroma below which a beat is treated as having rendered no colour at all. Comfortably above
 *  encode/scale noise (a near-black frame peaks around 2) and far below any saturated element (the
 *  reference frame for the motivating case peaked at 224). */
export const GREYSCALE_CHROMA_MAX = 12;

export interface BeatQa {
  segment: number;
  frames: number[];
  /** Frame-wide mean Δ per consecutive probe pair. */
  meanDiffs: number[];
  /** Largest single-tile mean Δ per consecutive probe pair. */
  maxTileDiffs: number[];
  /** Tiles per pair at or above SUBJECT_TILE_MEAN. */
  movingTiles: number[];
  stats: FrameStats[];
  underAnimated: boolean;
  subjectStatic: boolean;
}

export interface MotionQaReport {
  grid: { cols: number; rows: number };
  raster: { width: number; height: number };
  subjectTileMean: number;
  beats: BeatQa[];
}

/** Human-readable findings for one beat (empty = nothing to report). */
export function beatFindings(b: BeatQa): string[] {
  const out: string[] = [];
  const fmt = (xs: number[]) => xs.map((d) => d.toFixed(2)).join(" / ");
  if (b.underAnimated) {
    out.push(
      `segment[${b.segment}] barely animates across the beat (probe Δ ${fmt(b.meanDiffs)}) — ` +
        `a poster with a dissolve, not motion; add entrance/life/speech layers (skills/motion-design)`,
    );
  } else if (b.subjectStatic) {
    out.push(
      `segment[${b.segment}] animates only diffusely — no tile moves more than ` +
        `${SUBJECT_TILE_MEAN} (max tile Δ ${fmt(b.maxTileDiffs)}, frame Δ ${fmt(b.meanDiffs)}). ` +
        `A background wash is moving while the subject holds still.`,
    );
  }
  // Greyscale output from a beat whose author intended colour is the other defect a still hides.
  //
  // Thresholded on PEAK chroma, not the mean: the mean is dominated by background. Measured on the
  // motivating case — a mostly-black beat whose colour smears never rendered — the broken frame and
  // the correct reference frame had mean chromas of 0.01 and 1.29, so any mean-based threshold either
  // missed the bug or flagged the intended look. Their peaks were 2 and 224.
  if (b.stats.length) {
    const chromaMax = Math.max(...b.stats.map((s) => s.chromaMax));
    if (chromaMax < GREYSCALE_CHROMA_MAX) {
      out.push(
        `segment[${b.segment}] renders essentially greyscale (peak chroma ${chromaMax}, ` +
          `${Math.max(...b.stats.map((s) => s.colors))} distinct colours) — expected if the beat is ` +
          `monochrome by design; a bug if any coloured element should be visible.`,
      );
    }
  }
  return out;
}

export interface MotionQaOpts {
  props: KinoProps;
  publicDir: string;
  format: FormatId;
  quality?: QualityPreset;
  /** Write the machine-readable report here (usually beside the stills). */
  reportPath?: string;
}

/**
 * Probe every full-screen motion beat and report. Never throws — QA is diagnostic, and a broken probe
 * must not take down a render the author is trying to look at.
 */
export async function runMotionQa(opts: MotionQaOpts): Promise<MotionQaReport | null> {
  const { props, publicDir, format, quality, reportPath } = opts;
  try {
    const picks = probeFramePicks(props.segments, props.fps);
    if (!picks.length) return null;
    const dir = scratchDir("kino-probe-");
    try {
      const frames = picks.flatMap((p) => p.frames.map((f, j) => ({ frame: f, name: `probe-${p.segment}-${j}` })));
      const outs = await renderStills({ props, publicDir, format, frames, outDir: dir, quality });
      const beats: BeatQa[] = [];
      let k = 0;
      for (const p of picks) {
        const mine = outs.slice(k, k + p.frames.length);
        k += p.frames.length;
        const bufs = await Promise.all(mine.map((f) => decodeRgbAt(f, QA_W, QA_H)));
        const stats = bufs.map(frameStats);
        const meanDiffs: number[] = [];
        const maxTileDiffs: number[] = [];
        const movingTiles: number[] = [];
        const tilesPerPair: number[][] = [];
        for (let j = 1; j < bufs.length; j++) {
          const tiles = tileDiffs(bufs[j - 1]!, bufs[j]!, QA_W, QA_H, SUBJECT_TILE_GRID.cols, SUBJECT_TILE_GRID.rows);
          tilesPerPair.push(tiles);
          meanDiffs.push(seamDiff(bufs[j - 1]!, bufs[j]!));
          maxTileDiffs.push(tiles.length ? Math.max(...tiles) : 0);
          movingTiles.push(tiles.filter((t) => t >= SUBJECT_TILE_MEAN).length);
        }
        beats.push({
          segment: p.segment,
          frames: p.frames,
          meanDiffs,
          maxTileDiffs,
          movingTiles,
          stats,
          underAnimated: isUnderAnimated(meanDiffs),
          subjectStatic: isSubjectStatic(tilesPerPair),
        });
      }
      const report: MotionQaReport = {
        grid: { cols: SUBJECT_TILE_GRID.cols, rows: SUBJECT_TILE_GRID.rows },
        raster: { width: QA_W, height: QA_H },
        subjectTileMean: SUBJECT_TILE_MEAN,
        beats,
      };
      for (const b of beats) for (const m of beatFindings(b)) log.warn(m);
      if (reportPath) {
        try {
          writeFileSync(reportPath, JSON.stringify(report, null, 2));
          log.info(`  · motion QA report → ${reportPath}`);
        } catch (e) {
          log.warn(`motion QA report not written: ${(e as Error).message}`);
        }
      }
      return report;
    } finally {
      releaseScratch(dir);
    }
  } catch (e) {
    log.warn(`motion QA skipped: ${(e as Error).message}`);
    return null;
  }
}

/** Default sidecar location for a stills/storyboard run. */
export function qaReportPath(outDir: string, base = "motion-qa"): string {
  return join(outDir, `${base}.json`);
}
