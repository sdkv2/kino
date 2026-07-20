// Video-in-page strategy: <video> seeking is not reliably frame-exact, so the engine pre-extracts
// the EXACT source frame for every composition-local frame of every video usage (avatar windows,
// app cut-in beats) with ffmpeg, and the page shows plain <img> elements. The local→source mapping
// mirrors the composition math one-to-one: trimBefore + localFrame·speed, with appFreezeFrame
// (pauseAt / clipTo holds) pinning the clock — the same pure helper the page component calls.
import { execa } from "execa";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { appFreezeFrame, appTrimFrames } from "../appMedia.js";
import type { KinoProps } from "../props.js";

export interface MediaJob {
  key: string; // "av<i>" | "seg<i>"
  assetRel: string; // publicDir-relative source
  fromFrame: number; // composition frame the usage mounts at
  seqDurFrames: number; // frames the usage is mounted for
  startSec: number; // source time of local frame 0
  stepSec: number; // source-time advance per live local frame
  effFrame: (localFrame: number) => number; // local frame → effective (freeze-pinned) frame
  maxEffFrame: number; // largest effective frame any local frame maps to
}

export interface MediaEntryNode {
  dir: string;
  byFrame: Record<number, string>; // effective local frame → image file name
  maxFrame: number; // largest populated index (page clamps EOF/freeze overruns to this)
}

const f = (s: number, fps: number) => Math.round(s * fps);

/** Sequence length for app segment i — replicates the chained-crossfade extension in KinoVideo. */
export function appSeqDurFrames(segments: KinoProps["segments"], i: number, fps: number): number {
  const s = segments[i];
  const next = segments[i + 1];
  const beatDur = f(s.endSec, fps) - f(s.startSec, fps);
  return next?.kind === "app" ? f(next.startSec, fps) - f(s.startSec, fps) + 12 : beatDur;
}

export function planMediaJobs(props: KinoProps, fps: number): MediaJob[] {
  const jobs: MediaJob[] = [];
  if (props.avatar) {
    props.avatarWindows.forEach((w, i) => {
      const dur = f(w.toSec, fps) - f(w.fromSec, fps);
      if (dur <= 0) return;
      const trimFrames = f(w.audioStartSec, fps);
      jobs.push({
        key: `av${i}`,
        assetRel: props.avatar!,
        fromFrame: f(w.fromSec, fps),
        seqDurFrames: dur,
        startSec: trimFrames / fps,
        stepSec: 1 / fps,
        effFrame: (n) => n,
        maxEffFrame: dur - 1,
      });
    });
  }
  props.segments.forEach((s, i) => {
    if (s.kind !== "app" || !s.asset) return;
    if (!/\.(mp4|mov)$/i.test(s.asset)) return; // images render directly
    const seqDur = appSeqDurFrames(props.segments, i, fps);
    if (seqDur <= 0) return;
    const speed = s.speed ?? 1;
    const { trimBefore } = appTrimFrames(fps, s.clipFrom, s.clipTo);
    const eff = (n: number) =>
      appFreezeFrame({ localFrame: n, fps, pauseAt: s.pauseAt, clipFrom: s.clipFrom, clipTo: s.clipTo, speed }) ?? n;
    let maxEff = 0;
    for (let n = 0; n < seqDur; n++) maxEff = Math.max(maxEff, eff(n));
    jobs.push({
      key: `seg${i}`,
      assetRel: s.asset,
      fromFrame: f(s.startSec, fps),
      seqDurFrames: seqDur,
      startSec: trimBefore / fps,
      stepSec: speed / fps,
      effFrame: eff,
      maxEffFrame: maxEff,
    });
  });
  return jobs;
}

const name = (n: number) => `f${String(n).padStart(6, "0")}.jpg`;

// Dense extraction (video renders): one sequential ffmpeg decode pass per usage. The fps filter
// resamples the stream so output frame n sits at source time startSec + n·stepSec — exactly the
// frame the composition asks for. JPEG q2 = visually lossless for photographic footage.
export async function extractDense(job: MediaJob, assetAbs: string, framesRoot: string): Promise<MediaEntryNode> {
  const dir = join(framesRoot, job.key);
  mkdirSync(dir, { recursive: true });
  const rate = 1 / job.stepSec;
  await execa("ffmpeg", [
    "-y", "-loglevel", "error",
    "-ss", job.startSec.toFixed(6),
    "-i", assetAbs,
    "-vf", `fps=${rate.toFixed(6)}`,
    "-frames:v", String(job.maxEffFrame + 1),
    "-q:v", "2",
    join(dir, "f%06d.jpg"),
  ]);
  // ffmpeg image2 numbers from 1; EOF may stop the run short (page clamps to maxFrame = hold last).
  const files = readdirSync(dir).filter((x) => x.endsWith(".jpg")).sort();
  const byFrame: Record<number, string> = {};
  files.forEach((file, idx) => (byFrame[idx] = file));
  return { dir: job.key, byFrame, maxFrame: Math.max(0, files.length - 1) };
}

// Sparse extraction (stills): only the requested local frames — one exact -ss seek each.
export async function extractSparse(job: MediaJob, assetAbs: string, framesRoot: string, localFrames: number[]): Promise<MediaEntryNode> {
  const dir = join(framesRoot, job.key);
  mkdirSync(dir, { recursive: true });
  const wanted = [...new Set(localFrames.map((n) => Math.min(job.maxEffFrame, job.effFrame(n))))].sort((a, b) => a - b);
  const byFrame: Record<number, string> = {};
  let maxFrame = 0;
  for (const e of wanted) {
    const srcTime = job.startSec + e * job.stepSec;
    const out = join(dir, name(e));
    await execa("ffmpeg", [
      "-y", "-loglevel", "error",
      "-ss", srcTime.toFixed(6),
      "-i", assetAbs,
      "-frames:v", "1",
      "-q:v", "2",
      out,
    ], { reject: false });
    if (!existsSync(out)) {
      // Past EOF (ffmpeg exits clean but writes nothing): fall back to the clip's final frame so
      // the still shows the hold, not a hole.
      await execa("ffmpeg", ["-y", "-loglevel", "error", "-sseof", "-0.2", "-i", assetAbs, "-frames:v", "1", "-q:v", "2", out], { reject: false });
    }
    if (existsSync(out)) {
      byFrame[e] = name(e);
      maxFrame = Math.max(maxFrame, e);
    }
  }
  return { dir: job.key, byFrame, maxFrame };
}
