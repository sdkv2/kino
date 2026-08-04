// Native render engine: headless-Chrome frame stepping → ffmpeg. Every frame is a pure function of
// its index (the page re-renders synchronously per seek; videos are pre-extracted stills; audio is
// mixed node-side), so the output is deterministic run-to-run. Public API mirrors render.ts.
import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { releaseScratch, scratchDir } from "../../scratch.js";
import { layersAt } from "../layers.js";
import { measureLayers, type ElementMeasure } from "../measure.js";
import { log } from "../../log.js";
import { FFMPEG_PATH } from "../../media/binPaths.js";
import type { KinoProps } from "../props.js";
import { buildAudioTrack, type AudioTrack } from "./audioMix.js";
import { angleBackend } from "./angle.js";
import { frameCacheCovers, frameSignatures, openFrameCache } from "./frameCache.js";
import { getPageBundle, getPageBundleHash } from "./pageBundle.js";
import { ensureRenderServer, takeCaptureBuffer, clearCaptureBuffers } from "./server.js";
import type { CaptureCodec } from "./captureCodec.js";
import type { CaptureSource } from "./captureSource.js";
import { extractDense, extractMaxDim, extractSparse, planDense, planMediaJobs, planMaskJobs, type MediaEntryNode } from "./videoFrames.js";
import type { WorkerHandle } from "./workerHandle.js";
import { acquireElectronWorker, prewarmElectronHosts, releaseElectronWorkers } from "./electron/slots.js";
import { loadGpuCapture, resolveElectronCapture, useSharedTextureCapture, type CaptureKind } from "./electron/gpuCapture.js";
import { compDims, DRAFT_SHORT_EDGE, FORMAT_DIMS, formatFileTag, maxOutputDim, scaledDims, type FormatId } from "../formats.js";
import { capWorkers, bytesPerWorker } from "./workerCap.js";
import { usableCores } from "./sandbox.js";

export function compositorEnabled(_env: NodeJS.ProcessEnv = process.env): boolean {
  return true;
}


const DIMS = FORMAT_DIMS;

function captureMode(env: NodeJS.ProcessEnv = process.env): "canvas" | "cdp" {
  const v = env.KINO_CAPTURE;
  if (v === "cdp") return "cdp";
  if (v === "canvas") return "canvas";
  return "canvas"; // M5: canvas-toDataURL ~5× faster than CDP screenshot
}

/**
 * Motion foreignObject supersample floor. Undefined = the page's default, which is now **1×**.
 *
 * `--quality very-high` raises it to 2×, and an explicit `KINO_MOTION_FO_SCALE` overrides both.
 * The 2× floor is not only antialiasing: at 1× the FO snaps transforms to whole pixels, so
 * sub-pixel motion steps visibly across frames — see motionRaster.MOTION_FO_MIN_SCALE. Feeds the
 * frame-cache key so runs at different floors can't cross-serve.
 */
export function resolveMotionFoMin(
  env: NodeJS.ProcessEnv = process.env,
  quality?: QualityPreset,
): number | undefined {
  const raw = Number(env.KINO_MOTION_FO_SCALE);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return quality === "very-high" ? 2 : undefined;
}

/** Render quality presets. Only supersampling varies today; the name leaves room for more. */
export type QualityPreset = "standard" | "very-high";

export function isQualityPreset(v: string): v is QualityPreset {
  return v === "standard" || v === "very-high";
}

/** CLI `--quality` → preset. Rejects typos loudly rather than silently rendering at 1×. */
export function parseQuality(v: string | undefined): QualityPreset | undefined {
  if (v == null) return undefined;
  if (!isQualityPreset(v)) throw new Error(`--quality must be "standard" or "very-high" (got "${v}")`);
  return v;
}

/**
 * Supersample factor. **Opt-in**: the default is 1.
 *
 * SS=2 costs 4x the composite fill and buys very little on most content — measured on the macOS
 * demo it moves glyphs ~0.007, SDF edges ~0.006 and photographic areas ~0.001. Procedural shader
 * content is where it earns its keep, so it is a deliberate `--quality very-high` choice rather
 * than something every render pays for.
 *
 * Precedence: an explicit KINO_SHADER_SSAA wins (calibration escape hatch), then draft forces 1
 * because it is a fast preview, then the preset.
 */
function resolveShaderSS(
  env: NodeJS.ProcessEnv = process.env,
  opts?: { mock?: boolean; quality?: QualityPreset },
): number {
  const e = Number(env.KINO_SHADER_SSAA);
  if (Number.isFinite(e) && e >= 1 && e <= 4) return Math.round(e);
  if (opts?.mock || env.KINO_SHADER_DRAFT === "1") return 1;
  return opts?.quality === "very-high" ? 2 : 1;
}

/**
 * Draft output resolution — the short edge, in px. A draft is a preview, so it renders the full
 * composition onto a 720p-class surface: same layout, ~2.25× fewer pixels to shade, capture and
 * encode. `KINO_DRAFT_EDGE=off` renders a draft at full size; a number sets a different edge.
 */
export function resolveDraftEdge(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = env.KINO_DRAFT_EDGE;
  if (raw == null || raw === "") return DRAFT_SHORT_EDGE;
  if (/^(off|full|none|0)$/i.test(raw.trim())) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 64) {
    throw new Error(`KINO_DRAFT_EDGE must be a pixel count >= 64, or "off" (got "${raw}")`);
  }
  return Math.round(n);
}

/** FXAA edge post-pass on every shader background — cheap analytic AA on top of SS, so silhouettes
 *  stay clean without a higher (costlier) SS. On by default; KINO_SHADER_FXAA=0 disables. */
function resolveShaderFXAA(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.KINO_SHADER_FXAA !== "0";
}

export type EncodePreset = "medium" | "veryfast";

// rename() fails with EXDEV when the scratch dir (os.tmpdir, often tmpfs on Linux) and the
// output dir sit on different filesystems — fall back to copy + delete. fsImpl is injectable
// so the EXDEV path is unit-testable (it can't be provoked on a single-filesystem test host).
export function moveFile(
  src: string,
  dest: string,
  fsImpl: { renameSync: typeof renameSync; copyFileSync: typeof copyFileSync; rmSync: typeof rmSync } = {
    renameSync,
    copyFileSync,
    rmSync,
  },
): void {
  try {
    fsImpl.renameSync(src, dest);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
    fsImpl.copyFileSync(src, dest);
    fsImpl.rmSync(src, { force: true });
  }
}

// Composition length contract (matches the legacy calculateMetadata): last segment end, or a
// 30-second default when there are no segments.
function durationInFrames(props: KinoProps): number {
  const total = props.segments.length ? Math.max(...props.segments.map((s) => s.endSec)) : 30;
  return Math.max(1, Math.round(total * props.fps));
}

function capturePipelineEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.KINO_CAPTURE_PIPELINE !== "0" && captureMode(env) === "canvas";
}

/** Video builds default to WebCodecs H.264; stills and KINO_CAPTURE_CODEC=jpeg stay on JPEG q95. */
export function resolveCaptureCodec(env: NodeJS.ProcessEnv = process.env, forStills = false): CaptureCodec {
  if (forStills) return "jpeg";
  const v = env.KINO_CAPTURE_CODEC;
  if (v === "jpeg") return "jpeg";
  if (v === "h264") return "h264";
  return "h264";
}

/** Pixel path into VideoEncoder — benchmark with KINO_CAPTURE_SOURCE=bitmap|stream|videoframe. */
export function resolveCaptureSource(env: NodeJS.ProcessEnv = process.env): CaptureSource {
  const v = env.KINO_CAPTURE_SOURCE;
  if (v === "stream" || v === "videoframe" || v === "bitmap") return v;
  return "bitmap";
}

// Electron: one shared GPU host, N offscreen windows (parallel encode). Default cap is conservative;
// raise with KINO_CONCURRENCY when the box has headroom (VRAM, NVENC sessions, cores).
//
// 4 is measured, not assumed. Tried 6 on 2026-07-28 and reverted it: on the macOS-desktop motion
// spec (10-core M-series, idle) c=2 ran 20619 ms vs c=4 at 12020/13728 ms — ~1.6× SLOWER, worse
// than the pre-optimisation baseline — while c=6 won one rep by 1% and lost the next by 13%, i.e.
// indistinguishable from 4 but costing ~28% more RAM. Consistent with the independent c=4 knee in
// the 4K footage bench.
//
// The reason is the shape of the pipeline, so expect it to hold until that shape changes: after the
// perf work the dominant per-frame cost is `texture:motion0` — GPU lens composite + plate upload —
// at 19.8 ms of a 31.7 ms seek (62%), while the 3-plate FO raster is fully hidden behind it
// (prefetch-wait is 1.28 ms). Every worker contends for the one GPU, so added workers multiply the
// dominant cost; too few (c=2) stop hiding the ~14 ms/plate raster. Raising this ceiling needs LESS
// GPU work per frame, not more workers *in this host* — the other way out is more hosts, since the
// contended resource is one Chromium GPU process rather than the GPU. See electronHosts below.
const MAX_WORKERS_ELECTRON = 4;

/** Slots per host. The ceiling above is per-GPU-process, so this stays 4 however many hosts run. */
const SLOTS_PER_HOST = MAX_WORKERS_ELECTRON;
/** Beyond this, added hosts stopped paying: 8×4 measured 578 fps on a 4090 and 4 more workers
 *  (16 total windows) went backwards. Also a sanity bound on process count for huge machines. */
const MAX_HOSTS = 8;
/** Frames below which a render stays single-host. Each extra host costs ~2-5s of Electron boot,
 *  which a short render never earns back — 354 frames render in ~3s at sharded speed, so paying
 *  3s of boot to save 2.6s is a loss. */
const MIN_FRAMES_TO_SHARD = 600;
/** Frames per host, so a host is never spawned for a sliver of work it cannot amortise its boot
 *  against (~300 frames is ~2s of rendering). */
const MIN_FRAMES_PER_HOST = 300;

/**
 * How many Electron processes to spread this render's workers over.
 *
 * The per-host ceiling documented on MAX_WORKERS_ELECTRON is a property of the single Chromium GPU
 * process each Electron app owns, not of the GPU: measured 170-210 fps per host on an M4, an RTX
 * 3060 Ti and an RTX 4090 alike — three GPUs spanning ~10x in power. That comment predicted the
 * ceiling would hold "until that shape changes"; running several hosts changes it, because each
 * one brings its own GPU process.
 *
 * Measured end-to-end on this code path (RTX 3060, 23-core container, glass-refraction-demos,
 * 1301 frames, 2 reps alternating): 1 host/4 workers renders 28.2-30.3 fps, 3 hosts/12 workers
 * renders 56.3-63.2 — **2.04x**, or 1.53x on total wall clock (65.5s -> 42.7s). The extra hosts
 * cost ~700ms of added boot, which is why short renders stay single-host. Output is equivalent,
 * not merely fast: same frame count and duration, aligned PSNR 45.9dB against 32.3dB at a
 * one-frame offset, i.e. frames land in the right order.
 *
 * ~1.75 cores per worker, i.e. ~7 per 4-slot host, is fitted to those two optima rather than
 * guessed: 23 cores -> 3 hosts and 61 cores -> 8 both fall out of it exactly.
 *
 * Cores come from `usableCores()`, which reads the cgroup CPU quota. Neither `cpus().length` NOR
 * `availableParallelism()` is safe here: both report the affinity mask, and a container limited to
 * 23 cores on a 192-core host answers 192 to both (measured on vast.ai). Sizing hosts off that
 * would spawn 8 of them — 32 windows on 23 cores.
 */
export function electronHosts(
  totalFrames: number,
  env: NodeJS.ProcessEnv = process.env,
  cores: number = usableCores(),
): number {
  const override = Number(env.KINO_ELECTRON_HOSTS);
  if (Number.isFinite(override) && override >= 1) return Math.round(override);
  if (totalFrames < MIN_FRAMES_TO_SHARD) return 1;
  const byCores = Math.floor(cores / (SLOTS_PER_HOST * 1.75));
  const byFrames = Math.floor(totalFrames / MIN_FRAMES_PER_HOST);
  return Math.max(1, Math.min(byCores, byFrames, MAX_HOSTS));
}

export function concurrency(
  totalFrames: number,
  env: NodeJS.ProcessEnv = process.env,
  cores: number = usableCores(),
  platform: NodeJS.Platform = process.platform,
): number {
  const cap = Math.max(1, totalFrames);
  const override = Number(env.KINO_CONCURRENCY);
  if (Number.isFinite(override) && override >= 1) return Math.min(Math.round(override), cap);
  const perHost = Math.min(SLOTS_PER_HOST, Math.max(1, cores - 1));
  return Math.min(perHost * electronHosts(totalFrames, env, cores), cap);
}

// The render server and its config are process-wide singletons the pages re-read via kinoLoad();
// serialize render calls so concurrent callers can't swap state under each other's pages.
let renderLock: Promise<unknown> = Promise.resolve();
function withRenderLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = renderLock.then(fn, fn);
  renderLock = run.catch(() => {});
  return run;
}

// Wall time spent capturing across all workers, for the KINO_PROFILE dump.
let captureMs = 0;

/**
 * ffmpeg input args for the captured frame stream. One captured buffer = one output frame.
 *
 * For h264, `-r` (not just `-framerate`) is load-bearing: as an *input* option it tells ffmpeg to
 * ignore timing carried in the bitstream and generate constant-rate timestamps, which is exactly
 * the contract here. Without it the h264 parser derives PTS from the stream's own VUI timing, and
 * an all-intra capture — every picture an IDR, frame_num and POC pinned at 0 — has nothing to
 * derive an advancing timeline from. Measured on Linux (Chromium's OpenH264 software encoder, which
 * writes that VUI): 295 access units muxed as a 0.501s / 240fps track, which then made the av-sync
 * pass believe the video was 9.3s shorter than the audio, clone the last frame to cover it, and
 * re-encode the whole thing to 2362 frames. macOS/VideoToolbox happens not to write that timing,
 * so `-framerate` alone was enough there and this only ever bit the Linux path.
 */
export function encoderInputArgs(captureCodec: CaptureCodec, fps: number): string[] {
  if (captureCodec === "h264") {
    return ["-f", "h264", "-framerate", String(fps), "-r", String(fps), "-i", "-"];
  }
  return ["-f", "image2pipe", "-vcodec", "mjpeg", "-framerate", String(fps), "-i", "-"];
}

// Stream captured frames into ffmpeg. H.264 builds are already annex-B all-intra — remux with
// copy; JPEG builds use image2pipe mjpeg → libx264. Exported for the failure-semantics tests.
export function startEncoder(opts: {
  fps: number;
  out: string;
  audio: string | null;
  preset: EncodePreset;
  captureCodec: CaptureCodec;
}): { stdin: NodeJS.WritableStream; done: Promise<void>; kill: () => void } {
  const videoIn = encoderInputArgs(opts.captureCodec, opts.fps);
  const videoOut =
    opts.captureCodec === "h264"
      ? ["-c:v", "copy"]
      : [
          "-c:v", "libx264", "-preset", opts.preset, "-crf", "18",
          "-vf", "scale=out_color_matrix=bt709:out_range=tv",
          "-pix_fmt", "yuv420p",
          "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
        ];
  const args = [
    "-y", "-loglevel", "error",
    ...videoIn,
    ...(opts.audio ? ["-i", opts.audio] : []),
    "-map", "0:v", ...(opts.audio ? ["-map", "1:a"] : []),
    ...videoOut,
    ...(opts.audio ? ["-c:a", "aac", "-b:a", "320k"] : []),
    "-movflags", "+faststart",
    opts.out,
  ];
  const proc = spawn(FFMPEG_PATH, args, { stdio: ["pipe", "ignore", "pipe"] });
  let stderr = "";
  proc.stderr.on("data", (d) => (stderr += d));
  // ffmpeg dying mid-stream EPIPEs the frame writes. Unlistened, that stream 'error' is re-thrown
  // as an uncaught exception that beats the diagnostic-carrying `done` rejection to the console —
  // the exit reason (with stderr) is the report, the broken pipe is just its echo.
  proc.stdin.on("error", () => {});
  const done = new Promise<void>((resolve, reject) => {
    proc.on("close", (code, signal) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg encode failed (${signal ?? code}): ${stderr.trim()}`)),
    );
    proc.on("error", reject);
  });
  const kill = () => {
    // Deliberate teardown after an upstream failure: observe `done` first, so the SIGKILL's own
    // rejection can't crash the process as an unhandled rejection and mask the error that caused
    // the teardown (it printed as `ffmpeg encode failed (null)` with no trace of the real one).
    done.catch(() => {});
    try {
      proc.kill("SIGKILL");
    } catch {}
  };
  return { stdin: proc.stdin, done, kill };
}

/**
 * Bytes allowed to sit in ffmpeg's stdin buffer before the drain loop stops to let it catch up.
 *
 * A pipe's default highWaterMark is 64KB and an all-intra 1080p frame is ~208KB, so EVERY write
 * overshoots it, returns false, and — if honoured literally — parks the drain on a `drain` event
 * once per frame. The write itself always succeeds; `false` is advisory, not a failure. Measured
 * on an M4 (shotstack-parity, shared capture, 12 workers) that cost 4.33 ms/frame, **62.5% of the
 * whole frames phase**, and backed up far enough to park workers on the AHEAD window 9.5% of their
 * time — the frames phase went flat while wall got worse (17.24s at 4 workers, 17.90s at 12).
 *
 * So: keep writing while the buffer is under this cap, and only wait when it is genuinely deep.
 * 32MB is ~150 frames at this size — bounded memory (see logMemProfile), far above the per-frame
 * stall point.
 */
const STDIN_BUFFER_CAP = 32 * 1024 * 1024;

function writeFrame(stdin: NodeJS.WritableStream, buf: Buffer): Promise<void> {
  stdin.write(buf);
  // `writableLength` is what is actually queued; a Writable always accepts the write regardless.
  const queued = (stdin as unknown as { writableLength?: number }).writableLength ?? 0;
  if (queued < STDIN_BUFFER_CAP) return Promise.resolve();
  return new Promise<void>((resolve) => stdin.once("drain", resolve));
}

function logMemProfile(written: number, total: number): void {
  if (process.env.KINO_MEM_PROFILE !== "1") return;
  if (written > 0 && written % 120 !== 0 && written !== total) return;
  const mu = process.memoryUsage();
  const rss = (mu.rss / 1024 / 1024).toFixed(0);
  const heap = (mu.heapUsed / 1024 / 1024).toFixed(0);
  const ext = (mu.external / 1024 / 1024).toFixed(0);
  console.error(`[mem] frame ${written}/${total} node rss=${rss}MB heap=${heap}MB external=${ext}MB (Electron GPU/renderer separate)`);
}

// Render frames [0, total) across `workers` pages into the encoder, in order. Workers claim the
// next frame index; a single drain loop writes each frame as soon as its predecessor shipped,
// with a bounded look-ahead so memory stays flat.
export async function renderFrameRange(
  handles: WorkerHandle[],
  total: number,
  stdin: NodeJS.WritableStream,
  cache?: { get(n: number): Promise<Buffer | null>; put(n: number, buf: Buffer): Promise<void> },
  opts?: { pipeline?: boolean; gate?: (frame: number) => Promise<void> },
): Promise<void> {
  const pipeline = opts?.pipeline ?? capturePipelineEnabled();
  // Extraction may still be running (see planDenseMedia): a frame that draws a clip whose JPEGs
  // are not on disk yet would render with the footage silently absent — a wrong-pixels bug, not a
  // slow one. Only capture waits; a cache hit needs nothing from disk.
  const gate = opts?.gate;

  // Where does the frames phase actually go? Measured on a 4090/61-core box, the phase stayed flat
  // at 4.7-5.2s from 32 to 64 workers while CPU sat at 32% and the GPU at 14%, and workers were
  // busy only ~39% of it — so something downstream of the page serialises. These counters split
  // the candidates apart: `capture` is the parent's view of a seek (page work PLUS IPC and
  // event-loop queueing, so capture-minus-page-seek is parent overhead), `park` is workers stalled
  // on the AHEAD window, `drain-idle` is the writer waiting on an out-of-order frame, and `write`
  // is ffmpeg backpressure. Reported under KINO_PROFILE=1 beside the page's own profile.
  // Its own flag as well as KINO_PROFILE, because these counters are just performance.now() around
  // awaits (free), while KINO_PROFILE also turns on the page's per-phase timers — and those are
  // GL-FLUSHED, so they serialise the renderer and inflate the very numbers being measured.
  const prof = process.env.KINO_PROFILE === "1" || process.env.KINO_FRAMES_PROFILE === "1";
  const stat = { gate: 0, capture: 0, park: 0, drainIdle: 0, write: 0, captures: 0 };
  const clock = () => (prof ? performance.now() : 0);
  const add = (k: keyof typeof stat, t0: number) => {
    if (prof) stat[k] += performance.now() - t0;
  };
  const RUN = 16;
  // Scale AHEAD dynamically so workers >= 4 never park on backpressure while holding valid runs
  const AHEAD = Math.max(48, RUN * Math.max(1, handles.length));
  const ready = new Map<number, Buffer>();
  let next = 0; // next frame index to claim
  let written = 0; // next frame index to write
  let failure: Error | null = null;
  // Wake-all, not a single slot: workers and the drain wait concurrently, and a lone `wake`
  // variable drops every resolver but the last registrant — parked workers sleep forever and the
  // pipeline deadlocks near the AHEAD limit. Spurious wakes are fine; every loop re-checks.
  let waiters: Array<() => void> = [];
  const notify = () => {
    const w = waiters;
    waiters = [];
    for (const r of w) r();
  };
  const waitTick = () => new Promise<void>((resolve) => waiters.push(resolve));

  const storeLag = async (h: WorkerHandle, lagFrame: number | null, buf: Buffer | null) => {
    if (!pipeline || !buf || lagFrame === null) return;
    ready.set(lagFrame, buf);
    if (cache) await cache.put(lagFrame, buf);
  };

  const workers = handles.map(async (h) => {
    let lagFrame: number | null = null;
    let run = 0; // frames left in this worker's claimed run
    let cursor = 0; // next frame within it
    for (;;) {
      if (failure) return;
      if (run === 0 && next >= total) {
        await storeLag(h, lagFrame, await h.flush());
        notify();
        return;
      }
      if (run === 0 && next - written >= AHEAD) {
        // Hand back the run's trailing frame BEFORE parking. In pipeline mode seekAndCapture
        // returns the PREVIOUS frame's buffer, so a finished run leaves its last frame held
        // inside the worker. Parking while holding it deadlocks: drain cannot advance `written`
        // past that frame, so the backpressure that parked us never lifts. Claiming one frame at
        // a time hid this — the held frame was always far ahead of `written`, never the one drain
        // was waiting on.
        if (pipeline && lagFrame !== null) {
          await storeLag(h, lagFrame, await h.flush());
          lagFrame = null;
          notify();
        }
        const tp = clock();
        await waitTick();
        add("park", tp);
        continue;
      }
      if (run === 0) {
        cursor = next;
        run = Math.min(RUN, total - next);
        next += run;
      }
      const frame = cursor++;
      run--;
      try {
        const cached = cache ? await cache.get(frame) : null;
        if (cached) {
          if (pipeline) {
            await storeLag(h, lagFrame, await h.flush());
            lagFrame = null;
          }
          ready.set(frame, cached);
        } else {
          if (gate) {
            const tg = clock();
            await gate(frame);
            add("gate", tg);
          }
          const tc = clock();
          const buf = await h.seekAndCapture(frame);
          add("capture", tc);
          stat.captures++;
          if (pipeline) {
            await storeLag(h, lagFrame, buf);
            lagFrame = frame;
          } else {
            ready.set(frame, buf!);
            if (cache) await cache.put(frame, buf!);
          }
        }
      } catch (err) {
        failure = err as Error;
      }
      notify();
    }
  });

  const drain = (async () => {
    while (written < total) {
      if (failure) throw failure;
      const buf = ready.get(written);
      if (!buf) {
        const td = clock();
        await waitTick();
        add("drainIdle", td);
        continue;
      }
      ready.delete(written);
      const tw = clock();
      await writeFrame(stdin, buf);
      add("write", tw);
      written++;
      logMemProfile(written, total);
      notify();
    }
  })();

  const tAll = clock();
  await Promise.all([...workers, drain]);
  if (prof) {
    const wall = performance.now() - tAll;
    const w = handles.length;
    const per = (ms: number) => (ms / Math.max(1, stat.captures)).toFixed(2).padStart(7);
    // Worker-side totals are summed ACROSS workers, so compare them against wall x workers;
    // drain-side totals are single-threaded and compare against wall.
    const pctW = (ms: number) => `${((100 * ms) / Math.max(1, wall * w)).toFixed(1).padStart(5)}%`;
    const pctD = (ms: number) => `${((100 * ms) / Math.max(1, wall)).toFixed(1).padStart(5)}%`;
    console.error(`[frames profile] ${total} frames, ${w} workers, ${wall.toFixed(0)}ms wall`);
    console.error(`  worker  capture     ${per(stat.capture)} ms/frame  ${pctW(stat.capture)} of worker time`);
    console.error(`  worker  media-gate  ${per(stat.gate)} ms/frame  ${pctW(stat.gate)} of worker time`);
    console.error(`  worker  parked      ${per(stat.park)} ms/frame  ${pctW(stat.park)} of worker time (AHEAD backpressure)`);
    console.error(`  drain   idle        ${per(stat.drainIdle)} ms/frame  ${pctD(stat.drainIdle)} of wall (waiting on out-of-order frame)`);
    console.error(`  drain   write       ${per(stat.write)} ms/frame  ${pctD(stat.write)} of wall (ffmpeg backpressure)`);
    const busy = (100 * stat.capture) / Math.max(1, wall * w);
    console.error(`  → workers busy ${busy.toFixed(0)}% of the phase; the rest is idle or waiting`);
  }
  if (failure) throw failure;
}

interface PreparedMedia {
  framesDir: string;
  media: Record<string, MediaEntryNode>;
}

/** The shape prepareDenseMedia returns, with nothing extracted. Used when every frame is already
 *  cached: the page still needs a framesDir to resolve against, it just never asks for a frame. */
function emptyMedia(scratch: string): PreparedMedia {
  const framesDir = join(scratch, "vframes");
  mkdirSync(framesDir, { recursive: true });
  return { framesDir, media: {} };
}

/** Media whose manifest is final but whose pixels may still be landing. See planDenseMedia. */
interface OverlappedMedia extends PreparedMedia {
  /** Composition frame → the writes that must finish before that frame may be drawn. */
  gate: (frame: number) => Promise<void>;
  /** Rejects with the first write failure; awaited before the render is declared done. */
  all: Promise<void>;
}

/** `KINO_OVERLAP_EXTRACT=0` restores the old behaviour (extract fully, then render). */
export function overlapExtractionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.KINO_OVERLAP_EXTRACT !== "0";
}

/** Below this many usable cores, booting pages early starves extraction instead of hiding. */
const BOOT_AHEAD_MIN_CORES = 16;

/**
 * Whether to boot the render pages before the media manifest exists (see the call site).
 *
 * Gated on cores because it MOVES page-load work earlier rather than removing it, so it only pays
 * where there is spare CPU to absorb it. Measured on shotstack-parity, 16:9, cold:
 *
 * | box            | config     | off                  | on                                  |
 * |----------------|------------|----------------------|-------------------------------------|
 * | 4090, 61 cores | h=3 c=32   | 17.29s (boot 2.91s)  | **15.71s** (boot 0.36s)             |
 * | 4090, 61 cores | h=8 c=64   | 17.23s (boot 6.00s)  | 17.40s (boot 0.29s, media 1.66→7.5s)|
 * | M4, 10 cores   | defaults   | **17.24s**           | 20.19s                              |
 *
 * Boot leaves the critical path every time (2.91→0.36s, 6.00→0.29s) — but at 64 slots the page
 * loads simply reappear inside the media phase, and on a 10-core M4 they starve the extraction
 * ffmpegs outright and cost 17%. So it is on only where the machine is wide enough.
 *
 * `KINO_BOOT_AHEAD=1`/`=0` forces it either way.
 */
export function bootAheadEnabled(
  env: NodeJS.ProcessEnv = process.env,
  cores: number = usableCores(),
): boolean {
  if (env.KINO_BOOT_AHEAD === "0") return false;
  if (env.KINO_BOOT_AHEAD === "1") return true;
  return cores >= BOOT_AHEAD_MIN_CORES;
}

/**
 * Plan every extraction, then start the decodes WITHOUT waiting for them.
 *
 * The manifest is knowable after a probe (planDense), and the render server bakes it in at
 * point-time — so pages can boot and early frames can render while later clips are still being
 * decoded. Each frame waits only on the clips that actually cover it, via `gate`.
 *
 * Masks are deliberately excluded from the overlap and written eagerly here: their entry
 * optimistically advertises an `sdfByFrame` twin that `write()` withdraws if writeSdfSequence
 * fails, and a withdrawal after the server has baked the manifest would leave the page requesting
 * an s*.png that does not exist. Footage has no such conditional field.
 */
async function planDenseMedia(
  props: KinoProps,
  publicDir: string,
  scratch: string,
  maxDim?: number,
): Promise<OverlappedMedia> {
  const framesDir = join(scratch, "vframes");
  mkdirSync(framesDir, { recursive: true });
  const jobs = [...planMediaJobs(props, props.fps), ...planMaskJobs(props, props.fps)];
  const plans = await Promise.all(
    jobs.map((j) => planDense(j, join(publicDir, j.assetRel), framesDir, maxDim)),
  );
  const media: Record<string, MediaEntryNode> = {};
  jobs.forEach((j, i) => (media[j.key] = plans[i].entry));

  const isMask = (key: string) => key.startsWith("rsmask") || key.startsWith("lmask");
  // Masks first and eagerly — see the note above.
  for (let i = 0; i < jobs.length; i++) if (isMask(jobs[i].key)) await plans[i].write();

  // Overlapped writes, in timeline order so the frames the render reaches first are ready first.
  // Same pool of 3 as the eager path, and for the same measured reason (see prepareDenseMedia).
  const overlapped = jobs
    .map((j, i) => ({ job: j, write: plans[i].write }))
    .filter((x) => !isMask(x.job.key))
    .sort((a, b) => a.job.fromFrame - b.job.fromFrame);
  const done = new Map<string, Promise<void>>();
  const resolvers = new Map<string, () => void>();
  for (const { job } of overlapped) {
    done.set(job.key, new Promise<void>((res) => resolvers.set(job.key, res)));
  }
  let cursor = 0;
  const all = Promise.all(
    Array.from({ length: Math.min(3, overlapped.length) }, async () => {
      while (cursor < overlapped.length) {
        const { job, write } = overlapped[cursor++];
        await write();
        resolvers.get(job.key)!();
      }
    }),
  ).then(() => undefined);
  // A write failure must reject the frame that waits on it rather than hanging the drain forever.
  all.catch((err) => {
    for (const [key, res] of resolvers) {
      done.set(key, Promise.reject(err instanceof Error ? err : new Error(String(err))));
      res();
    }
  });

  const covering = (frame: number): Array<Promise<void>> => {
    const waits: Array<Promise<void>> = [];
    for (const { job } of overlapped) {
      if (frame >= job.fromFrame && frame < job.fromFrame + job.seqDurFrames) {
        const p = done.get(job.key);
        if (p) waits.push(p);
      }
    }
    return waits;
  };
  const gate = async (frame: number): Promise<void> => {
    const waits = covering(frame);
    if (waits.length) await Promise.all(waits);
  };
  return { framesDir, media, gate, all };
}

async function prepareDenseMedia(
  props: KinoProps,
  publicDir: string,
  scratch: string,
  maxDim?: number,
): Promise<PreparedMedia> {
  const framesDir = join(scratch, "vframes");
  mkdirSync(framesDir, { recursive: true });
  const jobs = [...planMediaJobs(props, props.fps), ...planMaskJobs(props, props.fps)];
  const media: Record<string, MediaEntryNode> = {};
  // Extraction is decode-bound; a small parallel pool keeps it off the critical path.
  //
  // 3 is not a placeholder — raising it measurably HURTS. On a 12-clip, 60s 1080p footage bench
  // (M4, 10 cores) the media lap went 5.4s -> 5.9s -> 6.4s at pools of 3, 6 and 12: ffmpeg is
  // already internally threaded, so more processes just contend. The work itself is the floor,
  // roughly half h264 decode and half JPEG encode (~1.9ms and ~1.7ms per 1080p frame measured
  // separately) — 12 clips fully parallel, one ffmpeg each, still takes 4.0s against this path's
  // 5.3s. Neither `-hwaccel videotoolbox` (0.34s vs 0.23s on a 64-frame chunk — setup dominates)
  // nor dropping the select filter (identical timings) moves it either.
  //
  // The levers that would actually pay are structural, not tuning: overlap extraction with the
  // render instead of gating on it, and skip it entirely when the frame cache already has every
  // frame it would feed.
  const pool = 3;
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(pool, jobs.length) }, async () => {
      while (i < jobs.length) {
        const job = jobs[i++];
        media[job.key] = await extractDense(job, join(publicDir, job.assetRel), framesDir, maxDim);
      }
    }),
  );
  return { framesDir, media };
}

async function pointServerAt(opts: {
  props: KinoProps;
  publicDir: string;
  framesDir: string;
  media: Record<string, MediaEntryNode>;
  width: number;
  height: number;
  /** Output canvas, when it differs from the composition (draft). */
  outWidth?: number;
  outHeight?: number;
  total: number;
  shaderSS: number;
  shaderFXAA: boolean;
  /** Resolved FO supersample floor — depends on the quality preset, so it cannot be re-read here. */
  motionFoMin: number | undefined;
  captureCodec: CaptureCodec;
  captureSource: CaptureSource;
}): Promise<{ url: string }> {
  const pageJs = await getPageBundle();
  return ensureRenderServer({
    publicDir: opts.publicDir,
    framesDir: opts.framesDir,
    pageJs,
    renderConfigJson: JSON.stringify({
      props: opts.props,
      width: opts.width,
      height: opts.height,
      outWidth: opts.outWidth ?? opts.width,
      outHeight: opts.outHeight ?? opts.height,
      durationInFrames: opts.total,
      media: opts.media,
      shaderSS: opts.shaderSS,
      shaderFXAA: opts.shaderFXAA,
      motionFoMin: opts.motionFoMin,
      profile: process.env.KINO_PROFILE === "1",
      // Counts per-plate pixel-identical motion rasters (see motionRaster.ts). Hashing every
      // plate costs real ms/frame, so it is its own flag — never folded into KINO_PROFILE,
      // whose timing rows it would pollute.
      motionDupeProbe: process.env.KINO_MOTION_DUPE_PROBE === "1",
      captureCodec: opts.captureCodec,
      captureSource: opts.captureSource,
    }),
  });
}

export interface NativeRenderOpts {
  props: KinoProps;
  publicDir: string;
  formats: FormatId[];
  outDir: string;
  title: string;
  preset?: EncodePreset; // veryfast for mock/preview builds; medium (default) for finals
  /** Supersampling is opt-in — see resolveShaderSS. */
  quality?: QualityPreset;
  /** Fast preview: SS=1 and a 720p-class output canvas (see resolveDraftEdge). Defaults to
   *  `preset === "veryfast"`, which is how build.ts has always signalled a draft. */
  draft?: boolean;
}

export function renderVideoNative(opts: NativeRenderOpts): Promise<string[]> {
  return withRenderLock(() => renderVideoLocked(opts));
}

async function renderVideoLocked({ props, publicDir, formats, outDir, title, preset = "medium", quality, draft }: NativeRenderOpts): Promise<string[]> {
  mkdirSync(outDir, { recursive: true });
  const scratch = scratchDir("kino-native-");
  const t0 = Date.now();
  const lap = (m: string) => {
    if (process.env.KINO_NATIVE_DEBUG) console.error(`[native timing] ${m} +${Date.now() - t0}ms`);
  };
  // One or more Electron hosts, each with N offscreen windows. Within a host the GPU process is
  // shared, so per-host worker count is bound by GPU memory rather than cores; across hosts the
  // bound is cores, since each host brings its own GPU process (see electronHosts).
  const total = durationInFrames(props);
  // Linux: capWorkers may lower n from probed VRAM and KINO_NVENC_SESSIONS (see workerCap.ts).
  // An explicit KINO_CONCURRENCY above that cap is a hard error — raise KINO_VRAM_PER_WORKER
  // if the estimate is wrong for your card.
  let n = concurrency(total);
  if (process.platform === "linux") {
    const probe = loadGpuCapture()?.gpuLimits?.();
    const sessions = Number(process.env.KINO_NVENC_SESSIONS);
    const capped = capWorkers(n, {
      vramFreeBytes: probe?.vramFreeBytes,
      bytesPerWorker: bytesPerWorker(),
      sessionLimit: Number.isFinite(sessions) && sessions >= 1 ? sessions : undefined,
    });
    if (capped.workers < n) {
      if (process.env.KINO_CONCURRENCY) {
        throw new Error(
          `KINO_CONCURRENCY=${n} exceeds what this GPU supports (${capped.workers}, limited by ` +
            `${capped.reason}). Lower it, or raise KINO_VRAM_PER_WORKER if the estimate is wrong.`,
        );
      }
      console.error(`  · workers ${n} → ${capped.workers} (limited by ${capped.reason})`);
      n = capped.workers;
    }
  }
  // Spread the (possibly VRAM-capped) worker count over hosts. An AUTO-derived count is clamped to
  // ceil(n / SLOTS_PER_HOST), because a host with fewer slots than that pays a full Electron boot
  // for a fraction of the work: it keeps an explicit KINO_CONCURRENCY=4 on one host rather than
  // thinly spread over three, and stops scripts/shard-render (which pins KINO_CONCURRENCY=4 per
  // build) from multiplying hosts by builds.
  //
  // An explicit KINO_ELECTRON_HOSTS is NOT clamped that way — asking for 2 hosts and 2 workers is a
  // deliberate one-window-per-host request (the cleanest way to isolate per-host GPU-process
  // contention from worker count), and silently collapsing it to one host would make the knob lie.
  // Only the "more hosts than workers" bound survives, since a host with no window does nothing.
  const explicitHosts = Number(process.env.KINO_ELECTRON_HOSTS);
  const hostCount =
    Number.isFinite(explicitHosts) && explicitHosts >= 1
      ? Math.max(1, Math.min(Math.round(explicitHosts), n))
      : Math.max(1, Math.min(electronHosts(total), Math.ceil(n / SLOTS_PER_HOST)));
  const slots = Array.from({ length: n }, (_, i) => i);
  const isDraft = draft ?? preset === "veryfast";
  // Mock (veryfast) → SS=1 (~4× cheaper shader/glass fill) unless KINO_SHADER_SSAA overrides.
  const ss = resolveShaderSS(process.env, { mock: isDraft, quality });
  // A draft also renders onto a smaller canvas — the composition is unchanged, it just lands on
  // fewer pixels (`out`), so shading, capture and encode all shrink with it.
  const draftEdge = isDraft ? resolveDraftEdge(process.env) : null;
  const outDimsOf = (fmt: FormatId) => (draftEdge ? scaledDims(fmt, draftEdge) : DIMS[fmt]);
  const foMin = resolveMotionFoMin(process.env, quality);
  const fx = resolveShaderFXAA(process.env);
  // The electron host forces its own ANGLE backend (angle.ts). Report the real one: gpu and sw
  // frames are not bit-identical, and a silent choice makes that impossible to spot.
  log.step(`gl: electron ANGLE/${angleBackend()} (forced)`);
  try {
    const endSec = total / props.fps;
    // Footage only ever has to serve the largest surface it lands on — which is the draft canvas
    // on a draft, so previews stop extracting (and decoding) 4K frames to paint 720p ones.
    const maxOut = Math.max(...formats.map((f) => Math.max(outDimsOf(f).width, outDimsOf(f).height)));

    // One definition of the cache key, used both to decide whether extraction is needed at all and
    // to open the cache below. Two copies would drift, and a drifted key silently extracts every
    // time (harmless) or skips extraction for a cache that will miss (not harmless).
    const sharedCapture = useSharedTextureCapture();
    const codecForCache: CaptureCodec = sharedCapture ? "h264" : "jpeg";
    const pageJsHash = await getPageBundleHash();
    const sigsFor = (fmt: FormatId, kind: CaptureKind | undefined): string[] => {
      const c = outDimsOf(fmt);
      return frameSignatures({
        props, publicDir, pageJsHash, width: c.width, height: c.height, total, fps: props.fps,
        shaderSS: ss, shaderFXAA: fx, motionFoMin: foMin, captureCodec: codecForCache, captureKind: kind,
      });
    };
    const cacheDirFor = (fmt: FormatId) => join(outDir, ".frame-cache", formatFileTag(fmt));

    // Extraction exists to feed the compositor, so it is dead work when every frame is already
    // cached — the common case in the iterate loop, and worth 5.45s of a 7.5s rebuild on a
    // 12-clip footage bench. The keys do not depend on extraction output, so this is
    // answerable up front. `resolveElectronCapture()` is the parent's PREDICTION: only the worker
    // can load the native addon, so an `auto` that predicts `shared` may still degrade to `direct`
    // in there. The mismatch is handled after boot rather than guessed at — see `lateMedia` below.
    const predictedKind = resolveElectronCapture();
    const skipExtraction = formats.every((f) => frameCacheCovers(cacheDirFor(f), sigsFor(f, predictedKind)));
    // Overlapped by default: plan every extraction (a probe each), publish the manifest, and let
    // the decodes run while pages boot and early frames render. Each frame waits only on the clips
    // covering it (`mediaGate`). KINO_OVERLAP_EXTRACT=0 restores the extract-then-render order.
    const overlap = overlapExtractionEnabled() && !skipExtraction;
    let mediaGate: ((frame: number) => Promise<void>) | undefined;
    let mediaWrites: Promise<void> | undefined;
    const extractMedia = async (): Promise<PreparedMedia> => {
      if (!overlap) return prepareDenseMedia(props, publicDir, scratch, extractMaxDim(maxOut, ss));
      const m = await planDenseMedia(props, publicDir, scratch, extractMaxDim(maxOut, ss));
      mediaGate = m.gate;
      mediaWrites = m.all;
      return { framesDir: m.framesDir, media: m.media };
    };
    // Spawning Electron does not depend on anything extraction produces — only the page load does
    // (it needs the server URL, which needs framesDir/media). Start the hosts now so Chromium's
    // startup overlaps the media lap instead of queueing behind it. See prewarmElectronHosts.
    prewarmElectronHosts(hostCount);

    // ...and then boot their PAGES too, before the manifest exists.
    //
    // Page load is a 1.5MB bundle fetch+parse, WebGL init and shader compile, once per slot, and
    // with overlapped extraction it became the dominant serial cost: measured on a 4090/61-core
    // box, pages-boot ran 2.96s at 32 workers and 7.59s at 64 while the frames phase floored at
    // ~4.9s, so wall got WORSE above c=32 even though rendering got faster. Prewarming the
    // processes did not help much because lever 1 shrank the media lap it was hiding behind from
    // 5.6s to ~1.0s.
    //
    // The page does not need the real manifest to load — only to render. server.ts keeps config as
    // per-render swappable state and pages re-init via window.kinoLoad(), and acquireElectronWorker
    // already takes that cheap `reload` path for an already-booted slot. So: point the server at an
    // empty media map, boot every slot against it, and let the normal acquire below re-point them
    // at the real manifest. No frame is captured in between, so the empty map is never drawn.
    const bootFmt = formats[0];
    const bootComp = compDims(bootFmt);
    const bootCanvas = outDimsOf(bootFmt);
    let bootAhead: Promise<unknown> = Promise.resolve();
    if (bootAheadEnabled()) {
      const preServer = await pointServerAt({
        props, publicDir, framesDir: emptyMedia(scratch).framesDir, media: {},
        width: bootComp.width, height: bootComp.height,
        outWidth: bootCanvas.width, outHeight: bootCanvas.height,
        total, shaderSS: ss, shaderFXAA: fx, motionFoMin: foMin,
        captureCodec: useSharedTextureCapture() ? "h264" : "jpeg",
        captureSource: resolveCaptureSource(process.env),
      });
      // Failures are swallowed on purpose: this is an optimisation, and the acquire in the format
      // loop below will boot the slot for real and report whatever went wrong with its own context.
      bootAhead = Promise.all(
        slots.map((i) =>
          acquireElectronWorker(i, preServer.url, bootCanvas.width, bootCanvas.height, props.fps, {
            hosts: hostCount,
          }),
        ),
      ).catch(() => undefined);
    }

    let mediaAndAudio: [PreparedMedia, AudioTrack];
    try {
      [mediaAndAudio] = await Promise.all([
        Promise.all([
          skipExtraction ? emptyMedia(scratch) : extractMedia(),
          buildAudioTrack(props, publicDir, endSec, scratch),
        ]) as Promise<[PreparedMedia, AudioTrack]>,
        bootAhead,
      ]);
    } catch (err) {
      // The hosts above were spawned before the try/finally that normally owns them, so on this
      // path nothing downstream would ever release them — they would outlive the failed render.
      await releaseElectronWorkers();
      throw err;
    }
    let [{ framesDir, media }, audioTrack] = mediaAndAudio;
    const audio = audioTrack.track;
    // Per-frame mix envelope (0..1 RMS), threaded to the page so motion graphics can react to
    // the audio (env.audio / --kino-audio). Attached to a COPY: props feeds the frame-cache key
    // (audio must not move it — see frameCache.ts) and is reused across formats, so mutating it
    // would either poison the key or leak the first format's envelope into the second.
    const renderProps = audioTrack.envelope ? { ...props, audio: audioTrack.envelope } : props;
    if (skipExtraction) log.step("media: extraction skipped (every frame already cached)");
    lap("media+audio");

    const outputs: string[] = [];
    try {
      for (const fmt of formats) {
        // `width`/`height` are the composition (always 1080-class — the space specs are
        // authored in); `canvas` is the surface it is rasterised onto. A draft shrinks the
        // canvas below the composition, a `*-4k` format doubles it — same frame either way,
        // and everything downstream of the page (window, capture, encode, cache key) follows
        // the canvas.
        const { width, height } = compDims(fmt);
        const canvas = outDimsOf(fmt);
        // The motion raster deliberately does NOT follow a shrunken canvas. Measured on the
        // macos-desktop-youtube spec, rasterising the FO at 0.667 was 17-33% SLOWER than at 1x:
        // the downscale it saves (motion:normalize) costs 0.01ms/frame, while a fractional SVG
        // raster scale drops Chromium onto a slower path. It would also cost the sub-pixel
        // motion the 1x floor exists to protect. Fewer pixels is not automatically less work.
        if (canvas.width !== width || canvas.height !== height) {
          log.step(`canvas: ${width}x${height} composition → ${canvas.width}x${canvas.height} output`);
        }
        const requestedSource = resolveCaptureSource(process.env);
        const electronShared = useSharedTextureCapture();
        const server = await pointServerAt({
          props: renderProps, publicDir, framesDir, media, width, height, outWidth: canvas.width, outHeight: canvas.height,
          total, shaderSS: ss, shaderFXAA: fx, motionFoMin: foMin,
          captureCodec: electronShared ? "h264" : "jpeg",
          captureSource: requestedSource,
        });

        const captureCodec: CaptureCodec = electronShared ? "h264" : "jpeg";
        // What the worker actually resolved, which can differ from the parent's guess: only the
        // worker can load the native addon, so `auto` may degrade there. Keys the frame cache.
        let electronKind: CaptureKind | null = null;

        const handles: WorkerHandle[] = await Promise.all(
          slots.map(async (i) => {
            const h = await acquireElectronWorker(i, server.url, canvas.width, canvas.height, props.fps, {
              hosts: hostCount,
            });
            electronKind ??= h.captureKind;
            return {
              seekAndCapture: async (frame: number) => {
                const t0 = performance.now();
                try {
                  return await h.seekAndCapture(frame);
                } finally {
                  captureMs += performance.now() - t0;
                }
              },
              flush: () => h.flush(),
              dumpProfile: h.dumpProfile,
            };
          }),
        );
        {
          // Worth a line of its own: sharding changes the process tree the user will see in Activity
          // Monitor / top, and it is the first thing to check when throughput looks wrong.
          if (hostCount > 1) {
            log.step(`workers: ${n} across ${hostCount} electron hosts (${Math.ceil(n / hostCount)}/host)`);
          }
          const elCap = electronKind ?? resolveElectronCapture();
          // NVENC on both win32 (DXGI/D3D11) and linux (CUDA); VideoToolbox is macOS only.
          const hw = process.platform === "darwin" ? "VideoToolbox" : "NVENC";
          log.step(
            elCap === "direct"
              ? "capture: electron/WebCodecs VideoFrame(canvas) → H.264 annex-B (no OSR paint)"
              : elCap === "readback"
                ? `capture: electron/readPixels → ${hw} H.264 annex-B`
                : elCap === "shared"
                  ? `capture: electron/paint → ${hw} H.264 annex-B (${process.platform === "win32" ? "DXGI" : "IOSurface"})`
                  : "capture: electron/capturePage JPEG q95",
          );
        }
        lap(`pages-boot ${fmt}`);

        // Coverage above was checked against the PREDICTED backend. If the worker resolved a
        // different one, the keys this render will use are not the keys proved cached, so the
        // cache is about to miss on footage we deliberately did not extract — and a miss with an
        // empty media map renders a real frame with the footage silently absent. Extract now and
        // re-point the page at it. Rare (it needs `auto` to degrade in the worker), but it is a
        // wrong-pixels bug rather than a slow one, so it is handled rather than assumed away.
        if (skipExtraction && electronKind && electronKind !== predictedKind) {
          log.step(`media: capture resolved to ${electronKind}, not ${predictedKind} — extracting after all`);
          ({ framesDir, media } = await extractMedia());
          await pointServerAt({
            props: renderProps, publicDir, framesDir, media, width, height, outWidth: canvas.width, outHeight: canvas.height,
            total, shaderSS: ss, shaderFXAA: fx, motionFoMin: foMin,
            captureCodec: electronShared ? "h264" : "jpeg",
            captureSource: requestedSource,
          });
          // Re-acquiring a booted slot reloads its page, which is what makes it re-read the config.
          await Promise.all(
            slots.map((i) =>
              acquireElectronWorker(i, server.url, canvas.width, canvas.height, props.fps, { hosts: hostCount }),
            ),
          );
        }

        const sigs = sigsFor(fmt, electronKind ?? undefined);
        const cache = openFrameCache(cacheDirFor(fmt), sigs);
        const tmpOut = join(scratch, `video-${formatFileTag(fmt)}.mp4`);
        const enc = startEncoder({ fps: props.fps, out: tmpOut, audio, preset, captureCodec });
        try {
          captureMs = 0;
          clearCaptureBuffers();
          // First failure wins: if ffmpeg dies mid-stream, surface ITS rejection (which carries
          // stderr) instead of waiting on a frame loop whose backpressure no exited process will
          // ever drain. The loser stays observed — `render` via the no-op catch (its workers get
          // torn down by releaseElectronWorkers below), `enc.done` via kill() in the catch path.
          const render = renderFrameRange(handles, total, enc.stdin, cache, {
            pipeline: true,
            gate: mediaGate,
          });
          render.catch(() => {});
          await Promise.race([
            render,
            enc.done.then(() => {
              throw new Error("ffmpeg exited before the frame stream ended");
            }),
          ]);
          // Every drawn frame gated on the clips covering it, but a clip covering no drawn frame
          // (or one still finishing its tail) could otherwise still be decoding into the scratch
          // dir this render is about to tear down. Also the point where a write failure surfaces.
          if (mediaWrites) await mediaWrites;
          lap(`frames ${fmt} (${cache.hits}/${total} cached)`);
          if (process.env.KINO_PROFILE === "1" && handles[0]?.dumpProfile) {
            await handles[0].dumpProfile(total, captureMs);
          }
          log.step(`mux ${fmt} (${captureCodec} → mp4)`);
          enc.stdin.end();
          await Promise.all([releaseElectronWorkers(), enc.done]);
        } catch (err) {
          enc.kill();
          throw err;
        }
        cache.commit();
        lap(`encode-flush ${fmt}`);
        const out = join(outDir, `${title}-${formatFileTag(fmt)}.mp4`);
        moveFile(tmpOut, out);
        outputs.push(out);
      }
    } finally {
      await releaseElectronWorkers();
    }
    return outputs;
  } finally {
    releaseScratch(scratch);
  }
}

// Deterministic layout geometry for one compositor layer. Re-exported for CLI measure sinks.
export type { ElementMeasure } from "../measure.js";
export { measureLayers } from "../measure.js";
export interface FrameMeasure {
  name: string;
  width: number; height: number;
  elements: ElementMeasure[];
}

export interface NativeStillsOpts {
  props: KinoProps;
  publicDir: string;
  format: FormatId;
  frames: Array<{ frame: number; name: string }>;
  outDir: string;
  // If provided, the engine collects [data-measure] element geometry at each rendered frame and
  // pushes one FrameMeasure per frame into this array (out-param — keeps the string[] return stable).
  measureSink?: FrameMeasure[];
  /** Supersampling is opt-in — see resolveShaderSS. */
  quality?: QualityPreset;
}

export function renderStillsNative(opts: NativeStillsOpts): Promise<string[]> {
  return withRenderLock(() => renderStillsLocked(opts));
}

async function renderStillsLocked({ props, publicDir, format, frames, outDir, measureSink, quality }: NativeStillsOpts): Promise<string[]> {
  mkdirSync(outDir, { recursive: true });
  const scratch = scratchDir("kino-native-still-");
  try {
    const total = durationInFrames(props);
    const maxFrame = total - 1;
    const wanted = frames.map(({ frame, name }) => ({ frame: Math.min(maxFrame, Math.max(0, frame)), name }));

    // Sparse extraction: only the video frames these stills actually show.
    const framesDir = join(scratch, "vframes");
    mkdirSync(framesDir, { recursive: true });
    const media: Record<string, MediaEntryNode> = {};
    for (const job of [...planMediaJobs(props, props.fps), ...planMaskJobs(props, props.fps)]) {
      const locals = wanted
        .map(({ frame }) => frame - job.fromFrame)
        .filter((local) => local >= 0 && local < job.seqDurFrames);
      if (!locals.length) continue;
      media[job.key] = await extractSparse(job, join(publicDir, job.assetRel), framesDir, locals, extractMaxDim(maxOutputDim([format]), resolveShaderSS(process.env, { quality })));
    }

    // Same comp/out split as the video path: stills of a `*-4k` format compose at the
    // 1080-class canvas and rasterise onto the UHD surface.
    const { width, height } = compDims(format);
    const canvas = DIMS[format];
    try {
      const ss = resolveShaderSS(process.env, { quality });
      const foMin = resolveMotionFoMin(process.env, quality);
      const fx = resolveShaderFXAA(process.env);
      const server = await pointServerAt({
        props, publicDir, framesDir, media, width, height, outWidth: canvas.width, outHeight: canvas.height,
        total, shaderSS: ss, shaderFXAA: fx, motionFoMin: foMin,
        captureCodec: "jpeg",
        captureSource: "bitmap",
      });
      // captureMode "page" is load-bearing, not a default: shared/readback/direct all emit annex-B
      // H.264, and a still needs an image. Pinning it here also stops `auto` from resolving to a
      // hardware encoder on a machine that has one.
      const handle = await acquireElectronWorker(0, server.url, canvas.width, canvas.height, props.fps, {
        captureMode: "page",
      });
      const outs: string[] = [];
      // Prime the capture pipeline before the first real still, and throw the result away.
      //
      // Without this the FIRST still of every batch comes back with `kino-lens` glass missing —
      // correct field, correct geometry, correct chrome, but no refraction, no film, no dispersion.
      // It is positional, not content-dependent: rendering three near-identical frames breaks
      // whichever is requested first, and reordering moves the defect with it. Video is immune
      // because its encode loop is continuously pipelined; only the first drain of a cold pipeline
      // hands back a paint captured before the compositor's GPU lens layer has landed.
      //
      // Cost is one discarded frame per `kino still` / `kino storyboard` invocation. That is worth
      // paying: those two commands are what visual QA looks at, so the untreated bug quietly showed
      // reviewers a glassless frame and invited the wrong conclusion about the render.
      if (wanted.length > 0) {
        await handle.seekAndCapture(wanted[0]!.frame);
        await handle.flush();
      }
      for (const { frame, name } of wanted) {
        // NOTE: JPEG bytes in a `.png` file. That mislabel predates the electron port and is
        // preserved deliberately — consumers pass these paths to tools that sniff magic bytes, and
        // renaming them is a behaviour change unrelated to retiring puppeteer.
        const out = join(outDir, `${name}.png`);
        // The worker pipelines by one frame: seekAndCapture(N) hands back frame N-1 and the last
        // frame only ever emerges from flush(). That is right for a video encode loop and wrong
        // here, where every still is independent — so seek, then immediately drain THIS frame.
        // flush() clears encodeInflight, so the next seekAndCapture has no backlog to return.
        await handle.seekAndCapture(frame);
        const buf = await handle.flush();
        if (!buf) throw new Error(`capture returned empty frame ${frame}`);
        const { writeFileSync } = await import("node:fs");
        writeFileSync(out, buf);
        outs.push(out);
        if (measureSink) {
          const elements = measureLayers(layersAt(props, frame, { width, height }), { width, height });
          measureSink.push({ name, width, height, elements });
        }
      }
      return outs;
    } finally {
      await releaseElectronWorkers();
    }
  } finally {
    releaseScratch(scratch);
  }
}
