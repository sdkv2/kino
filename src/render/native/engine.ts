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
import type { Browser, Page } from "puppeteer";
import { log } from "../../log.js";
import { FFMPEG_PATH } from "../../media/binPaths.js";
import type { KinoProps } from "../props.js";
import { buildAudioTrack } from "./audioMix.js";
import { acquireBrowser, glMode, releaseBrowser } from "./browser.js";
import { frameSignatures, openFrameCache } from "./frameCache.js";
import { getPageBundle, getPageBundleHash } from "./pageBundle.js";
import { ensureRenderServer, takeCaptureBuffer, clearCaptureBuffers } from "./server.js";
import type { CaptureCodec } from "./captureCodec.js";
import type { CaptureSource } from "./captureSource.js";
import { extractDense, extractMaxDim, extractSparse, planMediaJobs, planMaskJobs, type MediaEntryNode } from "./videoFrames.js";
import type { WorkerHandle } from "./workerHandle.js";
import { acquireElectronWorker, releaseElectronWorkers } from "./electron/slots.js";
import { resolveElectronCapture, useSharedTextureCapture } from "./electron/gpuCapture.js";
import { resolveRenderer, type NativeRenderer } from "./renderer.js";
import { FORMAT_DIMS, formatFileTag, maxOutputDim, type FormatId } from "../formats.js";

export function compositorEnabled(_env: NodeJS.ProcessEnv = process.env): boolean {
  return true;
}

export { resolveRenderer, type NativeRenderer };

const DIMS = FORMAT_DIMS;

function captureMode(env: NodeJS.ProcessEnv = process.env): "canvas" | "cdp" {
  const v = env.KINO_CAPTURE;
  if (v === "cdp") return "cdp";
  if (v === "canvas") return "canvas";
  return "canvas"; // M5: canvas-toDataURL ~5× faster than CDP screenshot
}

/** 1–4 supersample. Default 2. Mock/draft → 1 unless KINO_SHADER_SSAA overrides. */
function resolveShaderSS(env: NodeJS.ProcessEnv = process.env, opts?: { mock?: boolean }): number {
  const e = Number(env.KINO_SHADER_SSAA);
  if (Number.isFinite(e) && e >= 1 && e <= 4) return Math.round(e);
  if (opts?.mock || env.KINO_SHADER_DRAFT === "1") return 1;
  return 2;
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

// Binding resource is GPU memory / Metal, not CPU cores. Puppeteer: each worker = own Chrome GPU
// process — peaks at 2; 3+ regresses. Electron: one shared host, N offscreen windows, each with
// its own VT session (parallel encode). Default 2; override with KINO_CONCURRENCY after measuring.
const MAX_WORKERS = 2;
export function concurrency(
  totalFrames: number,
  env: NodeJS.ProcessEnv = process.env,
  cores: number = cpus().length,
): number {
  const cap = Math.max(1, totalFrames);
  const override = Number(env.KINO_CONCURRENCY);
  if (Number.isFinite(override) && override >= 1) return Math.min(Math.round(override), cap);
  return Math.min(MAX_WORKERS, Math.max(1, cores - 1), cap);
}

// The render server and its config are process-wide singletons the pages re-read via kinoLoad();
// serialize render calls so concurrent callers can't swap state under each other's pages.
let renderLock: Promise<unknown> = Promise.resolve();
function withRenderLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = renderLock.then(fn, fn);
  renderLock = run.catch(() => {});
  return run;
}

export interface PageHandle {
  page: Page;
  seek: (frame: number) => Promise<void>;
  shot: () => Promise<Buffer | null>;
  /** One CDP round-trip: seek then kick capture (saves ~2–4 ms/frame vs split calls). */
  seekAndCapture: (frame: number) => Promise<Buffer | null>;
  flush: () => Promise<Buffer | null>;
}

// Booted pages cached per worker slot: a page stays on the singleton server's origin, so later
// render calls re-init it with window.kinoLoad() (fonts + config + frame 0) instead of paying a
// navigation + full React boot (~0.7s) each call. Invalidated when its browser idle-closed.
const pageCache = new Map<number, Page>();

async function awaitBoot(page: Page): Promise<void> {
  // Poll from node (each evaluate is a direct CDP call) — in-page rAF/timer polling is throttled
  // on background tabs, and every worker page but the frontmost one is a background tab.
  const deadline = Date.now() + 60000;
  for (;;) {
    const state = (await page.evaluate("window.__kinoError ?? (window.__kinoReady === true)")) as string | boolean;
    if (typeof state === "string") throw new Error(`native render page failed to boot:\n${state}`);
    if (state === true) return;
    if (Date.now() > deadline) {
      const diag = await page
        .evaluate(
          `JSON.stringify({ readyState: document.readyState, boot: typeof window.kinoSeek, imgs: Array.from(document.images).map(i => ({ src: i.src.slice(-40), complete: i.complete })) })`,
        )
        .catch((e) => `diag failed: ${e}`);
      throw new Error(`native render page did not become ready within 60s\n${diag}`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function workerHandle(slot: number, browser: Browser, url: string, width: number, height: number): Promise<WorkerHandle> {
  const p = await workerPageInner(slot, browser, url, width, height);
  return {
    seekAndCapture: (frame) => p.seekAndCapture(frame),
    flush: () => p.flush(),
    dumpProfile: (frames, captureMs) => dumpProfile(p, frames, captureMs),
  };
}

async function workerPageInner(slot: number, browser: Browser, url: string, width: number, height: number): Promise<PageHandle> {
  let page = pageCache.get(slot) ?? null;
  if (page && (page.isClosed() || page.browser() !== browser)) {
    pageCache.delete(slot);
    page = null;
  }
  if (page) {
    const vp = page.viewport();
    if (!vp || vp.width !== width || vp.height !== height) {
      await page.setViewport({ width, height, deviceScaleFactor: 1 });
    }
    await page.evaluate("window.kinoLoad()"); // re-init from the server's current config
  } else {
    page = await browser.newPage();
    if (process.env.KINO_NATIVE_DEBUG) {
      page.on("console", (m) => console.error(`[native page ${m.type()}] ${m.text().slice(0, 500)}`));
      page.on("pageerror", (e) => console.error(`[native pageerror] ${(e as Error).message}`));
      page.on("requestfailed", (r) => console.error(`[native reqfail] ${r.url()} ${r.failure()?.errorText}`));
    }
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.goto(`${url}/index.html`, { waitUntil: "load", timeout: 60000 });
    await awaitBoot(page);
    pageCache.set(slot, page);
  }
  const p = page;
  const pipelined = capturePipelineEnabled();
  return {
    page: p,
    seek: async (frame: number) => {
      // Read window.__kinoFatal in the SAME evaluate as the seek — one CDP round-trip per frame,
      // not two. A shader that won't compile leaves the beat rendering without it, so without
      // this the render completes and ships a silently flat frame (see page/fatal.ts). kinoSeek
      // already awaits region-shader init, so any fault is recorded by the time it resolves.
      const fatal = (await p.evaluate(
        `window.kinoSeek(${frame}).then(() => window.__kinoFatal ?? null)`,
      )) as string | null;
      if (fatal) throw new Error(`native render page reported a fatal fault on frame ${frame}:\n${fatal}`);
    },
    // One-shot API (stills / motion probe): must return the frame just seeked. Pipelined
    // capture kicks encode+POST async and relies on flush()/lag tracking in renderFrameRange —
    // calling it here leaves takeCaptureBuffer empty ("capture returned empty frame N").
    shot: async () => {
      const t0 = performance.now();
      try {
        return await captureFrom(p, false, slot);
      } finally {
        captureMs += performance.now() - t0;
      }
    },
    seekAndCapture: async (frame: number) => {
      const t0 = performance.now();
      try {
        const cap = pipelined ? `window.kinoCapturePipelined(${slot})` : `window.kinoCaptureSync(${slot})`;
        const fatal = (await p.evaluate(
          `window.kinoSeek(${frame}).then(() => ${cap}).then(() => window.__kinoFatal ?? null)`,
        )) as string | null;
        if (fatal) throw new Error(`native render page reported a fatal fault on frame ${frame}:\n${fatal}`);
        return takeCaptureBuffer(slot) ?? null;
      } finally {
        captureMs += performance.now() - t0;
      }
    },
    flush: async () => {
      if (!pipelined) return null;
      const t0 = performance.now();
      try {
        return await flushCaptureFrom(p, slot);
      } finally {
        captureMs += performance.now() - t0;
      }
    },
  };
}

// Wall time spent in shot() across all workers, for the KINO_PROFILE dump.
let captureMs = 0;

async function captureFrom(p: Page, pipelined: boolean, slot: number): Promise<Buffer | null> {
  if (captureMode() === "canvas") {
    if (pipelined) {
      await p.evaluate(`window.kinoCapturePipelined(${slot})`);
    } else {
      await p.evaluate(`window.kinoCaptureSync(${slot})`);
    }
    return takeCaptureBuffer(slot) ?? null;
  }
  return Buffer.from(await p.screenshot({ type: "jpeg", quality: 95 }));
}

async function flushCaptureFrom(p: Page, slot: number): Promise<Buffer | null> {
  await p.evaluate("window.kinoFlushCapture()");
  return takeCaptureBuffer(slot) ?? null;
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
  const videoIn =
    opts.captureCodec === "h264"
      ? ["-f", "h264", "-framerate", String(opts.fps), "-i", "-"]
      : ["-f", "image2pipe", "-vcodec", "mjpeg", "-framerate", String(opts.fps), "-i", "-"];
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

const writeFrame = (stdin: NodeJS.WritableStream, buf: Buffer) =>
  new Promise<void>((resolve, reject) => {
    stdin.write(buf, (err) => (err ? reject(err) : resolve()));
  });

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
  const AHEAD = 48; // max undrained frames in memory
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
    for (;;) {
      if (failure) return;
      if (next >= total) {
        await storeLag(h, lagFrame, await h.flush());
        notify();
        return;
      }
      if (next - written >= AHEAD) {
        await waitTick();
        continue;
      }
      const frame = next++;
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
      profile: process.env.KINO_PROFILE === "1",
      captureCodec: opts.captureCodec,
      captureSource: opts.captureSource,
    }),
  });
}

/**
 * Dump one worker page's phase totals. KINO_PROFILE=1 only: the page flushes GL after each phase
 * to attribute cost correctly, which makes the profiled render slower than a real one — read the
 * shares, not the wall time. Node-side capture cost is reported alongside for comparison.
 * seekAndCapture includes seek time in the capture tally — use wall time for capture wins.
 */
async function dumpProfile(handle: PageHandle, frames: number, captureMs: number): Promise<void> {
  const rows = (await handle.page.evaluate("window.__kinoProf ? window.__kinoProf() : []")) as Array<{
    key: string;
    ms: number;
    n: number;
  }>;
  if (!rows.length) return;
  const draw = rows.find((r) => r.key === "draw")?.ms ?? 0;
  const total = rows.filter((r) => r.key === "draw" || r.key.startsWith("prep:")).reduce((a, r) => a + r.ms, 0);
  console.error(`[native profile] one worker page, ${frames} frames (GL-flushed; shares not wall time)`);
  for (const r of rows) {
    if (r.ms >= 1) {
      const share = total > 0 ? ((r.ms / total) * 100).toFixed(1).padStart(5) : "    -";
      console.error(
        `  ${r.key.padEnd(24)} ${(r.ms / Math.max(1, r.n)).toFixed(2).padStart(7)} ms/call  ×${String(r.n).padStart(4)}  ${share}% of prep+draw`,
      );
    }
  }
  console.error(`  ${"[node] capture".padEnd(24)} ${(captureMs / Math.max(1, frames)).toFixed(2).padStart(7)} ms/frame (all workers)`);
  console.error(`  draw total ${draw.toFixed(0)}ms of ${total.toFixed(0)}ms prep+draw`);
}

export interface NativeRenderOpts {
  props: KinoProps;
  publicDir: string;
  formats: FormatId[];
  outDir: string;
  title: string;
  preset?: EncodePreset; // veryfast for mock/preview builds; medium (default) for finals
}

export function renderVideoNative(opts: NativeRenderOpts): Promise<string[]> {
  return withRenderLock(() => renderVideoLocked(opts));
}

async function renderVideoLocked({ props, publicDir, formats, outDir, title, preset = "medium" }: NativeRenderOpts): Promise<string[]> {
  mkdirSync(outDir, { recursive: true });
  const scratch = scratchDir("kino-native-");
  const t0 = Date.now();
  const lap = (m: string) => {
    if (process.env.KINO_NATIVE_DEBUG) console.error(`[native timing] ${m} +${Date.now() - t0}ms`);
  };
  // One browser PER WORKER — CDP screenshot capture serializes within a browser process, so
  // worker parallelism only pays off across processes.
  const total = durationInFrames(props);
  const n = concurrency(total);
  const slots = Array.from({ length: n }, (_, i) => i);
  // Mock (veryfast) → SS=1 (~4× cheaper shader/glass fill) unless KINO_SHADER_SSAA overrides.
  const ss = resolveShaderSS(process.env, { mock: preset === "veryfast" });
  const fx = resolveShaderFXAA(process.env);
  const mode = glMode();
  // The backend is auto-detected per machine (resolveGL), so say which one this render used —
  // gpu and sw frames are not bit-identical, and a silent choice makes that impossible to spot.
  log.step(
    mode === "gpu"
      ? "gl: hardware ANGLE (KINO_GPU=0 for bit-stable SwiftShader)"
      : "gl: SwiftShader (software; KINO_GPU=1 for hardware ANGLE)",
  );
  const renderer = resolveRenderer();
  try {
    const endSec = total / props.fps;
    const [{ framesDir, media }, audio, workers] = await Promise.all([
      prepareDenseMedia(props, publicDir, scratch, extractMaxDim(maxOutputDim(formats), ss)),
      buildAudioTrack(props, publicDir, endSec, scratch),
      renderer === "electron"
        ? Promise.resolve(null)
        : Promise.all(slots.map((i) => acquireBrowser(i))),
    ]);
    lap("media+audio+browsers");

    const outputs: string[] = [];
    try {
      for (const fmt of formats) {
        const { width, height } = DIMS[fmt];
        const requestedCodec = resolveCaptureCodec(process.env);
        const requestedSource = resolveCaptureSource(process.env);
        const electronShared = renderer === "electron" && useSharedTextureCapture();
        const server = await pointServerAt({
          props, publicDir, framesDir, media, width, height, total, shaderSS: ss, shaderFXAA: fx,
          captureCodec: electronShared ? "h264" : renderer === "electron" ? "jpeg" : requestedCodec,
          captureSource: requestedSource,
        });

        let captureCodec: CaptureCodec = electronShared ? "h264" : "jpeg";
        let captureSource: CaptureSource = "bitmap";
        let handles: WorkerHandle[];

        if (renderer === "electron") {
          handles = await Promise.all(
            slots.map(async (i) => {
              const h = await acquireElectronWorker(i, server.url, width, height, props.fps);
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
            const elCap = resolveElectronCapture();
            log.step(
              elCap === "direct"
                ? "capture: electron/WebCodecs VideoFrame(canvas) → H.264 annex-B (no OSR paint)"
                : elCap === "readback"
                  ? `capture: electron/readPixels → ${process.platform === "win32" ? "NVENC" : "VideoToolbox"} H.264 annex-B`
                  : elCap === "shared"
                    ? `capture: electron/paint → ${process.platform === "win32" ? "NVENC H.264 annex-B (DXGI)" : "VideoToolbox H.264 annex-B (IOSurface)"}`
                    : "capture: electron/capturePage JPEG q95",
            );
          }
        } else {
          const browsers = workers!;
          handles = await Promise.all(browsers.map((b, i) => workerHandle(i, b, server.url, width, height)));
          const page0 = pageCache.get(0);
          if (!page0) throw new Error("puppeteer page boot failed");
          const meta = (await page0.evaluate(
            `({ codec: window.__kinoCaptureCodec ?? "jpeg", source: window.__kinoCaptureSource ?? "bitmap" })`,
          )) as { codec: CaptureCodec; source: CaptureSource };
          captureCodec = meta.codec;
          captureSource = meta.source;
          const capNote =
            captureCodec !== requestedCodec || captureSource !== requestedSource
              ? ` (wanted ${requestedCodec}/${requestedSource})`
              : "";
          log.step(`capture: ${captureCodec}/${captureSource}${capNote}`);
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
          mode,
          shaderSS: ss,
          shaderFXAA: fx,
          captureCodec,
        });
        const cache = openFrameCache(join(outDir, ".frame-cache", formatFileTag(fmt)), sigs);
        const tmpOut = join(scratch, `video-${formatFileTag(fmt)}.mp4`);
        const enc = startEncoder({ fps: props.fps, out: tmpOut, audio, preset, captureCodec });
        try {
          captureMs = 0;
          clearCaptureBuffers();
          await renderFrameRange(handles, total, enc.stdin, cache, {
            pipeline: renderer === "electron" || capturePipelineEnabled(),
          });
          lap(`frames ${fmt} (${cache.hits}/${total} cached)`);
          if (process.env.KINO_PROFILE === "1" && handles[0]?.dumpProfile) {
            await handles[0].dumpProfile(total, captureMs);
          }
          log.step(`mux ${fmt} (${captureCodec} → mp4)`);
          enc.stdin.end();
          await Promise.all([
            renderer === "electron" ? releaseElectronWorkers() : Promise.resolve(),
            enc.done,
          ]);
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
      if (renderer === "electron") {
        await releaseElectronWorkers();
      } else {
        await Promise.all(slots.map((i) => releaseBrowser(i)));
      }
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
}

export function renderStillsNative(opts: NativeStillsOpts): Promise<string[]> {
  return withRenderLock(() => renderStillsLocked(opts));
}

async function renderStillsLocked({ props, publicDir, format, frames, outDir, measureSink }: NativeStillsOpts): Promise<string[]> {
  mkdirSync(outDir, { recursive: true });
  const scratch = scratchDir("kino-native-still-");
  try {
    const total = durationInFrames(props);
    const maxFrame = total - 1;
    const wanted = frames.map(({ frame, name }) => ({ frame: Math.min(maxFrame, Math.max(0, frame)), name }));

    // Sparse extraction (only the video frames these stills show), overlapped with browser launch.
    const framesDir = join(scratch, "vframes");
    mkdirSync(framesDir, { recursive: true });
    const media: Record<string, MediaEntryNode> = {};
    const [browser] = await Promise.all([
      acquireBrowser(0),
      (async () => {
        for (const job of [...planMediaJobs(props, props.fps), ...planMaskJobs(props, props.fps)]) {
          const locals = wanted
            .map(({ frame }) => frame - job.fromFrame)
            .filter((local) => local >= 0 && local < job.seqDurFrames);
          if (!locals.length) continue;
          media[job.key] = await extractSparse(job, join(publicDir, job.assetRel), framesDir, locals, extractMaxDim(maxOutputDim([format]), resolveShaderSS(process.env)));
        }
      })(),
    ]);

    const { width, height } = DIMS[format];
    try {
      const ss = resolveShaderSS(process.env);
      const fx = resolveShaderFXAA(process.env);
      const server = await pointServerAt({
        props, publicDir, framesDir, media, width, height, total, shaderSS: ss, shaderFXAA: fx,
        captureCodec: "jpeg",
        captureSource: "bitmap",
      });
      const handle = await workerPageInner(0, browser, server.url, width, height);
      const outs: string[] = [];
      for (const { frame, name } of wanted) {
        await handle.seek(frame);
        const out = join(outDir, `${name}.png`);
        const buf = await handle.shot();
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
      await releaseBrowser(0);
    }
  } finally {
    releaseScratch(scratch);
  }
}
