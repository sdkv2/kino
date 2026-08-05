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
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { FFMPEG_PATH, FFPROBE_PATH } from "../../media/binPaths.js";
import { appFreezeFrame, appTrimFrames } from "../appMedia.js";
import type { KinoProps } from "../props.js";
import { writeSdfSequence } from "./sdfFrames.js";

export interface MediaJob {
  key: string; // "av<i>" | "seg<i>"
  assetRel: string; // publicDir-relative source
  fromFrame: number; // composition frame the usage mounts at
  seqDurFrames: number; // frames the usage is mounted for
  startSec: number; // source time of local frame 0
  stepSec: number; // source-time advance per live local frame
  effFrame: (localFrame: number) => number; // local frame → effective (freeze-pinned) frame
  maxEffFrame: number; // largest effective frame any local frame maps to
  // Mask jobs only: which RGBA channels this beat actually reads, so the SDF transform computes one
  // field per used object instead of four.
  maskChannels?: string[];
}

export interface MediaEntryNode {
  dir: string;
  byFrame: Record<number, string>; // effective local frame → image file name
  maxFrame: number; // largest populated index (page clamps EOF/freeze overruns to this)
  // Mask jobs only: the matching signed-distance-field frame per index, written beside the mask
  // frames by writeSdfSequence. Absent for footage, and absent for masks whose transform failed —
  // in which case kinoMaskDist falls back to its in-shader search and nothing else changes.
  sdfByFrame?: Record<number, string>;
}

const f = (s: number, fps: number) => Math.round(s * fps);

/** Sequence length for app segment i — replicates the chained-crossfade extension in KinoVideo. */
export function appSeqDurFrames(segments: KinoProps["segments"], i: number, fps: number): number {
  const s = segments[i];
  const next = segments[i + 1];
  const beatDur = f(s.endSec, fps) - f(s.startSec, fps);
  return next?.kind === "video" ? f(next.startSec, fps) - f(s.startSec, fps) + 12 : beatDur;
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
    if (s.kind !== "video") return;
    // Footage beat (or the region-shader asset texture): mp4/mov gets frame-extracted; images render directly.
    if (s.source && /\.(mp4|mov)$/i.test(s.source)) {
      const j = appMediaJob(props.segments, i, fps, `seg${i}`, s.source);
      if (j) jobs.push(j);
    }
    // Region-shader video mask(s) (uMask0..N): same source-time progression as the beat asset so a
    // clipped/frozen beat samples the matching mask frame. Routed through /vframes because <video>
    // seeking never advances under deterministic headless capture. One job per masks[] entry that's
    // a video (image masks need no extraction).
    const rs = s.regionShader;
    if (rs) {
      rs.masks.forEach((m, j) => {
        if (m.maskKind !== "video") return;
        const job = appMediaJob(props.segments, i, fps, `rsmask${i}_${j}`, m.maskSrc);
        if (job) jobs.push({ ...job, maskChannels: [m.channel] });
      });
      // Region-shader BACKDROP (uTex1): a second, unrelated clip behind the cutout subject. Its own
      // clock ON PURPOSE, which is why this is not an appMediaJob — the beat's clipFrom/speed/pauseAt
      // describe the beat's OWN source, and seeking a different file to the same second is arbitrary
      // rather than useful. So: the backdrop's frame 0 at the beat's start, one backdrop frame per
      // composition frame; extractIndices holds the last frame if the beat outlasts the clip. Routed
      // through /vframes rather than a <video> seek for the same reason the masks are — <video>
      // never advances under deterministic headless capture.
      if (rs.backdrop && /\.(mp4|mov)$/i.test(rs.backdrop)) {
        const seqDur = appSeqDurFrames(props.segments, i, fps);
        if (seqDur > 0) {
          jobs.push({
            key: `rsbd${i}`,
            assetRel: rs.backdrop,
            fromFrame: f(s.startSec, fps),
            seqDurFrames: seqDur,
            startSec: 0,
            stepSec: 1 / fps,
            effFrame: (n) => n,
            maxEffFrame: seqDur - 1,
          });
        }
      }
    }
  });
  // Declared layers that are real footage: same extraction contract as a `seg{i}` beat, keyed by
  // the layer's own id so registry.ts can bind it (`media[d.id]` → createFramesSource). The window
  // mirrors layers.ts §11b — a `segment` binding borrows that beat's window; otherwise fromSec/toSec
  // (default: whole composition). Clock is plain playback: no trim/speed/freeze on declared layers.
  for (const d of props.layers ?? []) {
    if (d.source?.kind !== "video") continue;
    if (!d.source.url || !/\.(mp4|mov)$/i.test(d.source.url)) continue; // stills render directly
    const bound = d.segment !== undefined ? props.segments[d.segment] : undefined;
    const fromSec = bound ? bound.startSec : (d.fromSec ?? 0);
    const compEndSec = props.segments.length ? props.segments[props.segments.length - 1].endSec : 0;
    const toSec = bound ? bound.endSec : (d.toSec ?? compEndSec);
    const fromFrame = f(fromSec, fps);
    const seqDur = f(toSec, fps) - fromFrame;
    if (seqDur <= 0) continue;
    jobs.push({
      key: d.id,
      assetRel: d.source.url,
      fromFrame,
      seqDurFrames: seqDur,
      startSec: 0,
      stepSec: 1 / fps,
      effFrame: (n) => n,
      maxEffFrame: seqDur - 1,
    });
  }
  return jobs;
}

/** Media jobs for layer masks that are files. Shape and layer masks need no extraction.
 *  Keyed `lmask<segmentIndex>` so it cannot collide with the region-shader `rsmask<i>_<j>`
 *  namespace, and `lmask-<layerId>` for declared layers' masks. SDF frames are written beside
 *  the mask frames by the same path region-shader masks already use. */
export function planMaskJobs(props: KinoProps, fps: number): MediaJob[] {
  const jobs: MediaJob[] = [];
  props.segments.forEach((s, i) => {
    const mask = (s as { mask?: { source?: { kind?: string; src?: string; channel?: string } } }).mask;
    if (mask?.source?.kind !== "file" || !mask.source.src) return;
    const seqDur = Math.max(1, f(s.endSec, fps) - f(s.startSec, fps));
    const ch = mask.source.channel ?? "a";
    jobs.push({
      key: `lmask${i}`,
      assetRel: mask.source.src,
      fromFrame: f(s.startSec, fps),
      seqDurFrames: seqDur,
      startSec: 0,
      stepSec: 1 / fps,
      effFrame: (lf: number) => lf,
      maxEffFrame: seqDur - 1,
      maskChannels: [ch],
    });
  });
  // Declared layers' file masks: same contract as a segment's, keyed by the layer id (mirrors how
  // planMediaJobs keys a declared video layer by id). Window mirrors layers.ts §11b — segment
  // binding borrows that beat's window, else fromSec/toSec, else the whole composition.
  for (const d of props.layers ?? []) {
    const mask = d.mask as { source?: { kind?: string; src?: string; channel?: string } } | undefined;
    if (mask?.source?.kind !== "file" || !mask.source.src) continue;
    const bound = d.segment !== undefined ? props.segments[d.segment] : undefined;
    const fromSec = bound ? bound.startSec : (d.fromSec ?? 0);
    const compEndSec = props.segments.length ? props.segments[props.segments.length - 1].endSec : 0;
    const toSec = bound ? bound.endSec : (d.toSec ?? compEndSec);
    const fromFrame = f(fromSec, fps);
    const seqDur = Math.max(1, f(toSec, fps) - fromFrame);
    const ch = mask.source.channel ?? "a";
    jobs.push({
      key: `lmask-${d.id}`,
      assetRel: mask.source.src,
      fromFrame,
      seqDurFrames: seqDur,
      startSec: 0,
      stepSec: 1 / fps,
      effFrame: (lf: number) => lf,
      maxEffFrame: seqDur - 1,
      maskChannels: [ch],
    });
  }
  return jobs;
}

/** MediaJob for app segment i's clip (asset or mask): shares the beat's trim/speed/freeze clock. */
function appMediaJob(segments: KinoProps["segments"], i: number, fps: number, key: string, assetRel: string): MediaJob | null {
  const s = segments[i];
  const seqDur = appSeqDurFrames(segments, i, fps);
  if (seqDur <= 0) return null;
  const speed = s.speed ?? 1;
  const { trimBefore } = appTrimFrames(fps, s.clipFrom, s.clipTo);
  const eff = (n: number) =>
    appFreezeFrame({ localFrame: n, fps, pauseAt: s.pauseAt, clipFrom: s.clipFrom, clipTo: s.clipTo, speed }) ?? n;
  let maxEff = 0;
  for (let n = 0; n < seqDur; n++) maxEff = Math.max(maxEff, eff(n));
  return {
    key,
    assetRel,
    fromFrame: f(s.startSec, fps),
    seqDurFrames: seqDur,
    startSec: trimBefore / fps,
    stepSec: speed / fps,
    effFrame: eff,
    maxEffFrame: maxEff,
  };
}

interface VideoInfo {
  pts: number[]; // presentation timestamps, sorted ascending (display order)
  transfer: string;
}

const probeVideoCache = new Map<string, Promise<VideoInfo>>();
const probeSizeCache = new Map<string, Promise<{ width: number; height: number }>>();

export function clearVideoProbeCache(): void {
  probeVideoCache.clear();
  probeSizeCache.clear();
}

async function probeVideo(abs: string): Promise<VideoInfo> {
  let cached = probeVideoCache.get(abs);
  if (!cached) {
    cached = (async () => {
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
    })();
    probeVideoCache.set(abs, cached);
  }
  return cached;
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
  maxDim?: number,
): Promise<MediaEntryNode> {
  const p = await planIndices(job, assetAbs, framesRoot, localFrames, maxDim);
  await p.write();
  return p.entry;
}

async function planIndices(
  job: MediaJob,
  assetAbs: string,
  framesRoot: string,
  localFrames: number[],
  maxDim?: number,
): Promise<PlannedExtraction> {
  const dir = join(framesRoot, job.key);
  mkdirSync(dir, { recursive: true });
  const empty = (): PlannedExtraction => ({
    entry: { dir: job.key, byFrame: {}, maxFrame: 0 },
    write: async () => {},
  });
  const { pts, transfer } = await probeVideo(assetAbs);
  if (!pts.length) return empty();
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
  if (!uniq.length) return empty();

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
  // Masks are the ONLY asset that needs EXACT pixels. kinoMaskDist reads a coverage gradient to
  // pick its analytic branch, and JPEG's DCT quantization alone — even from a bit-exact mask.mp4 —
  // puts ~25k px/frame of a packed multi-object mask over the 0.05 gate. PNG is also SMALLER than
  // JPEG for binary masks (0.33MB vs 1.12MB per 24 frames @1080x1920), so exactness costs no disk
  // here. Footage stays JPEG but at q1 with 4:4:4 chroma: the old q2/4:2:0 default added ~60%
  // block-edge energy over the decoded source and blotched near-monochrome gradients (blue fog —
  // chroma carries the ramp and JPEG quantizes subsampled chroma hardest). Measured on that
  // pathological clip: q1+444 is +1.1 dB (all of it chroma) for 0.16→0.24s and 2.7→4.3MB per
  // 100 frames — noise next to the page's texture-upload cost. PNG would erase the last ~2.8
  // block-energy points but at 5.5× disk and 3.6× extraction wall; not worth it as a default.
  const isMask = job.key.startsWith("rsmask") || job.key.startsWith("lmask");
  const ext = isMask ? "png" : "jpg";
  const quality = isMask ? [] : ["-q:v", "1", "-pix_fmt", "yuvj444p"];

  // The manifest is computed HERE, before a single frame is decoded, so callers may publish it to
  // the render server while write() is still running. `-start_number` makes the numbering
  // contiguous across chunks, so uniq[i] is always x{i+1} — no readdir needed to know the names.
  const nameAt = (i: number) => `x${String(i + 1).padStart(6, "0")}.${ext}`;
  const byFrame: Record<number, string> = {};
  let maxFrame = 0;
  uniq.forEach((idx, i) => {
    for (const eff of wanted.get(idx)!) {
      byFrame[eff] = nameAt(i);
      maxFrame = Math.max(maxFrame, eff);
    }
  });
  // Masks also advertise a signed-distance twin per frame (s%06d.png beside x%06d.png). Predicting
  // it is safe because write() only publishes the field if writeSdfSequence actually succeeded —
  // see the sdfOk flag below, which clears these entries on failure.
  const sdfByFrame: Record<number, string> = {};
  if (isMask) for (const [k, v] of Object.entries(byFrame)) sdfByFrame[Number(k)] = v.replace(/^x/, "s");
  const entry: MediaEntryNode = {
    dir: job.key,
    byFrame,
    maxFrame,
    ...(isMask ? { sdfByFrame } : {}),
  };

  const write = async (): Promise<void> => {
  for (let c = 0; c < uniq.length; c += CHUNK) {
    const part = uniq.slice(c, c + CHUNK);
    const terms = part.map((i) => `between(t\\,${(pts[i] - 0.002).toFixed(6)}\\,${(pts[i] + 0.002).toFixed(6)})`);
    const select = `select='${terms.join("+")}'`;
    // Masks are never downscaled: writeSdfSequence below builds its distance field against
    // probeSize(assetAbs), i.e. the source dimensions, so a resized frame would mismatch.
    const fit = maxDim && !isMask ? scaleFilter(maxDim) : "";
    const vf = [select, hdr, fit].filter(Boolean).join(",");
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
      ...quality,
      join(dir, `x%06d.${ext}`),
    ]);
  }
  // EOF can shorten the run: ffmpeg simply stops producing files once the source ends. The manifest
  // above already names x{i+1} for every wanted index, so materialise the clamp ON DISK (copy the
  // last real frame into the missing names) rather than aliasing it in the map. Same "hold last
  // frame" result, but it keeps the manifest predictable — which is the whole point of planning it
  // before the decode, since the server bakes it in at point-time and cannot be told later.
  const written = readdirSync(dir).filter((x) => x.startsWith("x") && x.endsWith(`.${ext}`)).sort();
  if (!written.length) {
    // Nothing decoded at all: strip the manifest so the page draws no footage rather than
    // requesting files that will never exist.
    for (const k of Object.keys(byFrame)) delete byFrame[Number(k)];
    for (const k of Object.keys(sdfByFrame)) delete sdfByFrame[Number(k)];
    entry.maxFrame = 0;
    return;
  }
  const last = join(dir, written[written.length - 1]);
  for (let i = written.length; i < uniq.length; i++) copyFileSync(last, join(dir, nameAt(i)));

  if (!isMask) return;
  // Masks additionally get an exact signed distance field, so kinoMaskDist is one tap at any radius
  // instead of a 24-tap search that facets past ~10px. Best-effort: a failure here leaves
  // sdfByFrame undefined and the shader keeps its old behaviour.
  let sdfOk = false;
  try {
    const { width, height } = await probeSize(assetAbs);
    sdfOk = Boolean(await writeSdfSequence({
      srcPattern: join(dir, `x%06d.${ext}`),
      outDir: dir,
      outPattern: join(dir, "s%06d.png"),
      width,
      height,
      channels: job.maskChannels ?? ["gray"],
    }));
  } catch {
    // Best effort: no field means kinoMaskDist keeps its in-shader search, which is exactly the
    // behaviour every mask had before fields existed. Never fail a render over an optimisation.
  }
  // The plan optimistically advertised a field per frame; withdraw it if none was produced, so the
  // page never requests an s*.png that is not there.
  if (!sdfOk) {
    for (const k of Object.keys(sdfByFrame)) delete sdfByFrame[Number(k)];
    delete entry.sdfByFrame;
  }
  };

  return { entry, write };
}

/** Pixel dimensions of a decoded asset — the SDF transform needs them to frame the raw stream. */
async function probeSize(assetAbs: string): Promise<{ width: number; height: number }> {
  let cached = probeSizeCache.get(assetAbs);
  if (!cached) {
    cached = (async () => {
      const { stdout } = await execa(FFPROBE_PATH, [
        "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
        "-of", "csv=p=0:s=x", assetAbs,
      ]);
      const [w, h] = stdout.trim().split("x").map(Number);
      return { width: w, height: h };
    })();
    probeSizeCache.set(assetAbs, cached);
  }
  return cached;
}

// Deepest crop any shot applies to its source (push-in / pull-out peak — see shotTransform).
// Source pixels beyond output * this * ss are decoded and uploaded only to be thrown away.
const MAX_SHOT_ZOOM = 1.2;

/** Longest source edge worth extracting, given the largest output edge and the supersample
 *  factor. The whole compositor canvas is supersampled (renderer.ts: width = outW * ss), so the
 *  budget has to scale with it or SS=2 renders would lose real detail. */
export function extractMaxDim(outputMaxDim: number, ss: number): number {
  return Math.ceil(outputMaxDim * MAX_SHOT_ZOOM * Math.max(1, ss));
}

/** Fit-within filter: downscales only when the source exceeds the budget, preserves aspect, and
 *  keeps both edges even so the yuv420p paths stay legal. */
export function scaleFilter(maxDim: number): string {
  return `scale=w='min(iw,${maxDim})':h='min(ih,${maxDim})':force_original_aspect_ratio=decrease:force_divisible_by=2`;
}

// Dense extraction (video renders): every local frame of the usage.
export async function extractDense(
  job: MediaJob,
  assetAbs: string,
  framesRoot: string,
  maxDim?: number,
): Promise<MediaEntryNode> {
  const p = await planDense(job, assetAbs, framesRoot, maxDim);
  await p.write();
  return p.entry;
}

/**
 * A planned extraction whose manifest is final BEFORE any pixel is written.
 *
 * This is what lets the render overlap extraction instead of gating on it: the render server bakes
 * `media` into its config JSON at point-time (see pointServerAt), so the manifest has to be known
 * up front — but the JPEGs it names can still be appearing on disk while pages boot and early
 * frames render. `write()` is the expensive half; `entry` is available immediately after the
 * probe.
 */
export interface PlannedExtraction {
  entry: MediaEntryNode;
  write: () => Promise<void>;
}

/** Probe + plan a dense extraction without decoding anything. See PlannedExtraction. */
export async function planDense(
  job: MediaJob,
  assetAbs: string,
  framesRoot: string,
  maxDim?: number,
): Promise<PlannedExtraction> {
  if (!existsSync(assetAbs)) {
    return { entry: { dir: job.key, byFrame: {}, maxFrame: 0 }, write: async () => {} };
  }
  const locals = Array.from({ length: job.seqDurFrames }, (_, n) => n);
  return planIndices(job, assetAbs, framesRoot, locals, maxDim);
}

// Sparse extraction (stills): only the requested local frames.
export async function extractSparse(
  job: MediaJob,
  assetAbs: string,
  framesRoot: string,
  localFrames: number[],
  maxDim?: number,
): Promise<MediaEntryNode> {
  if (!existsSync(assetAbs)) return { dir: job.key, byFrame: {}, maxFrame: 0 };
  return extractIndices(job, assetAbs, framesRoot, localFrames, maxDim);
}
