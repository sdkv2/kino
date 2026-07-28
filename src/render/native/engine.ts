// Native render engine: headless-Chrome frame stepping → ffmpeg. Every frame is a pure function of
// its index (the page re-renders synchronously per seek; videos are pre-extracted stills; audio is
// mixed node-side), so the output is deterministic run-to-run. Public API mirrors render.ts.
import { spawn } from "node:child_process";
import { cpus } from "node:os";
import { copyFileSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { releaseScratch, scratchDir } from "../../scratch.js";
import { layersAt } from "../layers.js";
import { measureLayers, type ElementMeasure } from "../measure.js";
import { log } from "../../log.js";
import { FFMPEG_PATH } from "../../media/binPaths.js";
import type { KinoProps } from "../props.js";
import { buildAudioTrack } from "./audioMix.js";
import { angleBackend } from "./angle.js";
import { frameSignatures, openFrameCache } from "./frameCache.js";
import { getPageBundle, getPageBundleHash } from "./pageBundle.js";
import { ensureRenderServer, takeCaptureBuffer, clearCaptureBuffers } from "./server.js";
import type { CaptureCodec } from "./captureCodec.js";
import type { CaptureSource } from "./captureSource.js";
import { extractDense, extractMaxDim, extractSparse, planMediaJobs, planMaskJobs, type MediaEntryNode } from "./videoFrames.js";
import type { WorkerHandle } from "./workerHandle.js";
import { acquireElectronWorker, releaseElectronWorkers } from "./electron/slots.js";
import { loadGpuCapture, resolveElectronCapture, useSharedTextureCapture, type CaptureKind } from "./electron/gpuCapture.js";
import { FORMAT_DIMS, formatFileTag, maxOutputDim, type FormatId } from "../formats.js";
import { capWorkers, bytesPerWorker } from "./workerCap.js";

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
const MAX_WORKERS_ELECTRON = 4;
export function concurrency(
  totalFrames: number,
  env: NodeJS.ProcessEnv = process.env,
  cores: number = cpus().length,
  platform: NodeJS.Platform = process.platform,
): number {
  const cap = Math.max(1, totalFrames);
  const override = Number(env.KINO_CONCURRENCY);
  if (Number.isFinite(override) && override >= 1) return Math.min(Math.round(override), cap);
  return Math.min(MAX_WORKERS_ELECTRON, Math.max(1, cores - 1), cap);
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
// copy; JPEG builds use image2pipe mjpeg → libx264.
function startEncoder(opts: {
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
  const done = new Promise<void>((resolve, reject) => {
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg encode failed (${code}): ${stderr}`))));
    proc.on("error", reject);
  });
  const kill = () => {
    try {
      proc.kill("SIGKILL");
    } catch {}
  };
  return { stdin: proc.stdin, done, kill };
}

function writeFrame(stdin: NodeJS.WritableStream, buf: Buffer): Promise<void> {
  if (!stdin.write(buf)) {
    return new Promise<void>((resolve) => stdin.once("drain", resolve));
  }
  return Promise.resolve();
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
  opts?: { pipeline?: boolean },
): Promise<void> {
  const pipeline = opts?.pipeline ?? capturePipelineEnabled();
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
        await waitTick();
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
          const buf = await h.seekAndCapture(frame);
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
        await waitTick();
        continue;
      }
      ready.delete(written);
      await writeFrame(stdin, buf);
      written++;
      logMemProfile(written, total);
      notify();
    }
  })();

  await Promise.all([...workers, drain]);
  if (failure) throw failure;
}

interface PreparedMedia {
  framesDir: string;
  media: Record<string, MediaEntryNode>;
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
      durationInFrames: opts.total,
      media: opts.media,
      shaderSS: opts.shaderSS,
      shaderFXAA: opts.shaderFXAA,
      motionFoMin: opts.motionFoMin,
      profile: process.env.KINO_PROFILE === "1",
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
}

export function renderVideoNative(opts: NativeRenderOpts): Promise<string[]> {
  return withRenderLock(() => renderVideoLocked(opts));
}

async function renderVideoLocked({ props, publicDir, formats, outDir, title, preset = "medium", quality }: NativeRenderOpts): Promise<string[]> {
  mkdirSync(outDir, { recursive: true });
  const scratch = scratchDir("kino-native-");
  const t0 = Date.now();
  const lap = (m: string) => {
    if (process.env.KINO_NATIVE_DEBUG) console.error(`[native timing] ${m} +${Date.now() - t0}ms`);
  };
  // One Electron host, N offscreen windows — the GPU process is shared, so worker count is bound
  // by GPU memory rather than by cores.
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
  const slots = Array.from({ length: n }, (_, i) => i);
  // Mock (veryfast) → SS=1 (~4× cheaper shader/glass fill) unless KINO_SHADER_SSAA overrides.
  const ss = resolveShaderSS(process.env, { mock: preset === "veryfast", quality });
  const foMin = resolveMotionFoMin(process.env, quality);
  const fx = resolveShaderFXAA(process.env);
  // The electron host forces its own ANGLE backend (angle.ts). Report the real one: gpu and sw
  // frames are not bit-identical, and a silent choice makes that impossible to spot.
  log.step(`gl: electron ANGLE/${angleBackend()} (forced)`);
  try {
    const endSec = total / props.fps;
    const [{ framesDir, media }, audio] = await Promise.all([
      prepareDenseMedia(props, publicDir, scratch, extractMaxDim(maxOutputDim(formats), ss)),
      buildAudioTrack(props, publicDir, endSec, scratch),
    ]);
    lap("media+audio");

    const outputs: string[] = [];
    try {
      for (const fmt of formats) {
        const { width, height } = DIMS[fmt];
        const requestedSource = resolveCaptureSource(process.env);
        const electronShared = useSharedTextureCapture();
        const server = await pointServerAt({
          props, publicDir, framesDir, media, width, height, total, shaderSS: ss, shaderFXAA: fx, motionFoMin: foMin,
          captureCodec: electronShared ? "h264" : "jpeg",
          captureSource: requestedSource,
        });

        const captureCodec: CaptureCodec = electronShared ? "h264" : "jpeg";
        // What the worker actually resolved, which can differ from the parent's guess: only the
        // worker can load the native addon, so `auto` may degrade there. Keys the frame cache.
        let electronKind: CaptureKind | null = null;

        const handles: WorkerHandle[] = await Promise.all(
          slots.map(async (i) => {
            const h = await acquireElectronWorker(i, server.url, width, height, props.fps);
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
        const sigs = frameSignatures({
          props,
          publicDir,
          pageJsHash: await getPageBundleHash(),
          width,
          height,
          total,
          fps: props.fps,
          shaderSS: ss,
          shaderFXAA: fx,
          motionFoMin: foMin,
          captureCodec,
          captureKind: electronKind ?? undefined,
        });
        const cache = openFrameCache(join(outDir, ".frame-cache", formatFileTag(fmt)), sigs);
        const tmpOut = join(scratch, `video-${formatFileTag(fmt)}.mp4`);
        const enc = startEncoder({ fps: props.fps, out: tmpOut, audio, preset, captureCodec });
        try {
          captureMs = 0;
          clearCaptureBuffers();
          await renderFrameRange(handles, total, enc.stdin, cache, { pipeline: true });
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

    const { width, height } = DIMS[format];
    try {
      const ss = resolveShaderSS(process.env, { quality });
      const foMin = resolveMotionFoMin(process.env, quality);
      const fx = resolveShaderFXAA(process.env);
      const server = await pointServerAt({
        props, publicDir, framesDir, media, width, height, total, shaderSS: ss, shaderFXAA: fx, motionFoMin: foMin,
        captureCodec: "jpeg",
        captureSource: "bitmap",
      });
      // captureMode "page" is load-bearing, not a default: shared/readback/direct all emit annex-B
      // H.264, and a still needs an image. Pinning it here also stops `auto` from resolving to a
      // hardware encoder on a machine that has one.
      const handle = await acquireElectronWorker(0, server.url, width, height, props.fps, {
        captureMode: "page",
      });
      const outs: string[] = [];
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
