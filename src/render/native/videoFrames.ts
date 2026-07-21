// Video-in-page strategy: <video> seeking is not reliably frame-exact, so the engine pre-extracts
// the EXACT source frame for every composition-local frame of every video usage (avatar windows,
// app cut-in beats) with ffmpeg, and the page shows plain <img> elements. The local→source mapping
// mirrors the composition math one-to-one: trimBefore + localFrame·speed, with appFreezeFrame
// (pauseAt / clipTo holds) pinning the clock — the same pure helper the page component calls.
//
// Source-frame pick rule (verified black-box against the legacy engine with an index-encoded
// 25fps source): the frame whose presentation timestamp is NEAREST the requested source time,
// ties toward the later frame. Selection is by explicit display-order index against the probed
// pts list — an fps-filter resample follows a different (pts-grid) rule, and frame≈time·rate
// arithmetic breaks entirely on VFR screen recordings.
import { execa } from "execa";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { FFMPEG_PATH, FFPROBE_PATH } from "../../media/binPaths.js";
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

interface VideoInfo {
  pts: number[]; // presentation timestamps, sorted ascending (display order)
  transfer: string;
}

async function probeVideo(abs: string): Promise<VideoInfo> {
  const [{ stdout: meta }, { stdout: packets }] = await Promise.all([
    execa(FFPROBE_PATH, [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=color_transfer",
      "-of", "default=noprint_wrappers=1", abs,
    ]),
    // Packet pts only — no decode, fast even on long clips. Sorting yields display order
    // regardless of B-frame reordering.
    execa(FFPROBE_PATH, [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "packet=pts_time",
      "-of", "csv=p=0", abs,
    ]),
  ]);
  const transfer = /color_transfer=([\w-]+)/.exec(meta)?.[1] ?? "";
  const pts = packets
    .split("\n")
    .map((l) => parseFloat(l))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  return { pts, transfer };
}

/** Display-order index of the frame whose pts is nearest `t` (ties → the later frame). */
function nearestPtsIndex(pts: number[], t: number): number {
  let lo = 0;
  let hi = pts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pts[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  // lo = first index with pts >= t; compare against its predecessor.
  if (lo > 0 && t - pts[lo - 1] < pts[lo] - t) return lo - 1;
  return lo;
}

// HDR sources (HLG / PQ) must be tone-mapped to SDR bt709 or the frames come out washed out —
// the legacy extractor tone-mapped for us. Preferred chain needs zscale (libzimg); many ffmpeg
// builds lack it, so fall back to the colorspace filter treating the HDR trc as bt2020-10 gamma —
// close for HLG (its lower range is gamma-like by design), acceptable for PQ.
let filterList: Promise<string> | null = null;
async function ffmpegFilters(): Promise<string> {
  filterList ??= execa(FFMPEG_PATH, ["-hide_banner", "-filters"]).then(
    (r) => r.stdout,
    () => "",
  );
  return filterList;
}

async function hdrChain(transfer: string): Promise<string | null> {
  if (transfer !== "arib-std-b67" && transfer !== "smpte2084") return null;
  const filters = await ffmpegFilters();
  if (/\bzscale\b/.test(filters)) {
    return "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable,zscale=t=bt709:m=bt709:r=tv,format=yuv420p";
  }
  if (/\bcolorspace\b/.test(filters)) {
    return "colorspace=all=bt709:iall=bt2020:itrc=bt2020-10:fast=0,format=yuv420p";
  }
  return null; // no capable filter — raw frames (washed out) beat a failed render
}

// Map every needed local frame to its source-frame index and extract each unique index once, in a
// single sequential decode (select by frame number). JPEG q2 = visually lossless for footage.
async function extractIndices(
  job: MediaJob,
  assetAbs: string,
  framesRoot: string,
  localFrames: number[],
): Promise<MediaEntryNode> {
  const dir = join(framesRoot, job.key);
  mkdirSync(dir, { recursive: true });
  const { pts, transfer } = await probeVideo(assetAbs);
  if (!pts.length) return { dir: job.key, byFrame: {}, maxFrame: 0 };
  // Key everything by the EFFECTIVE (freeze-pinned) frame — that is the clock value the page's
  // FrameVideo sees (Freeze pins useCurrentFrame to the pause frame), so it must be the map key.
  const wanted = new Map<number, number[]>(); // srcIndex → effective frames that show it
  for (const n of localFrames) {
    const eff = Math.min(job.maxEffFrame, job.effFrame(n));
    const idx = nearestPtsIndex(pts, job.startSec + eff * job.stepSec);
    const list = wanted.get(idx) ?? [];
    if (!list.includes(eff)) list.push(eff);
    wanted.set(idx, list);
  }
  const uniq = [...wanted.keys()].sort((a, b) => a - b);
  if (!uniq.length) return { dir: job.key, byFrame: {}, maxFrame: 0 };

  // Select by presentation TIME (±2ms window around each wanted pts — comfortably under any real
  // inter-frame gap), not by frame index: with an input pre-seek the index counter restarts, but
  // -copyts keeps `t` equal to the probed pts. Pre-seek to ~1s before the first wanted frame
  // (-noaccurate_seek lands on the prior keyframe) so a deep clipFrom into a long source doesn't
  // decode the whole head of the file.
  // ffmpeg 8's expression parser rejects long `+` chains (recursion limit lands between 80 and
  // 120 between() terms — "Cannot allocate memory"), so extract in chunks. -start_number keeps
  // the output numbering contiguous across chunks; indices are sorted, so an EOF-shortened run
  // still leaves a gap-free file list (later chunks are past EOF and produce nothing).
  const CHUNK = 64;
  const hdr = await hdrChain(transfer);
  for (let c = 0; c < uniq.length; c += CHUNK) {
    const part = uniq.slice(c, c + CHUNK);
    const terms = part.map((i) => `between(t\\,${(pts[i] - 0.002).toFixed(6)}\\,${(pts[i] + 0.002).toFixed(6)})`);
    const select = `select='${terms.join("+")}'`;
    const vf = hdr ? `${select},${hdr}` : select;
    const firstPts = pts[part[0]];
    const preseek = firstPts > 2 ? ["-ss", Math.max(0, firstPts - 1).toFixed(3), "-noaccurate_seek", "-copyts"] : [];
    await execa(FFMPEG_PATH, [
      "-y", "-loglevel", "error",
      ...preseek,
      "-i", assetAbs,
      "-vf", vf,
      "-fps_mode", "passthrough",
      "-frames:v", String(part.length),
      "-start_number", String(c + 1),
      "-q:v", "2",
      join(dir, "x%06d.jpg"),
    ]);
  }
  // Outputs arrive in source order → x000001.jpg maps to uniq[0], etc. EOF can shorten the run;
  // local frames whose index wasn't reached clamp to the last extracted file (hold last frame).
  const files = readdirSync(dir).filter((x) => x.startsWith("x") && x.endsWith(".jpg")).sort();
  const byFrame: Record<number, string> = {};
  let maxFrame = 0;
  if (!files.length) return { dir: job.key, byFrame, maxFrame: 0 };
  uniq.forEach((idx, i) => {
    const file = files[Math.min(i, files.length - 1)];
    for (const eff of wanted.get(idx)!) {
      byFrame[eff] = file;
      maxFrame = Math.max(maxFrame, eff);
    }
  });
  return { dir: job.key, byFrame, maxFrame };
}

// Dense extraction (video renders): every local frame of the usage.
export async function extractDense(job: MediaJob, assetAbs: string, framesRoot: string): Promise<MediaEntryNode> {
  if (!existsSync(assetAbs)) return { dir: job.key, byFrame: {}, maxFrame: 0 };
  const locals = Array.from({ length: job.seqDurFrames }, (_, n) => n);
  return extractIndices(job, assetAbs, framesRoot, locals);
}

// Sparse extraction (stills): only the requested local frames.
export async function extractSparse(job: MediaJob, assetAbs: string, framesRoot: string, localFrames: number[]): Promise<MediaEntryNode> {
  if (!existsSync(assetAbs)) return { dir: job.key, byFrame: {}, maxFrame: 0 };
  return extractIndices(job, assetAbs, framesRoot, localFrames);
}
