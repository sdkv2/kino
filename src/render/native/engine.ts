// Native render engine: headless-Chrome frame stepping → ffmpeg. Every frame is a pure function of
// its index (the page re-renders synchronously per seek; videos are pre-extracted stills; audio is
// mixed node-side), so the output is deterministic run-to-run. Public API mirrors render.ts.
import { spawn } from "node:child_process";
import { cpus, tmpdir } from "node:os";
import { copyFileSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Browser, Page } from "puppeteer";
import { FFMPEG_PATH } from "../../media/binPaths.js";
import type { KinoProps } from "../props.js";
import { buildAudioTrack } from "./audioMix.js";
import { acquireBrowser, glMode, releaseBrowser } from "./browser.js";
import { frameSignatures, openFrameCache } from "./frameCache.js";
import { getPageBundle, getPageBundleHash } from "./pageBundle.js";
import { ensureRenderServer } from "./server.js";
import { extractDense, extractSparse, planMediaJobs, type MediaEntryNode } from "./videoFrames.js";

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

const DIMS: Record<string, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "3:4": { width: 1080, height: 1440 },
  "16:9": { width: 1920, height: 1080 },
};

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

function concurrency(totalFrames: number): number {
  const env = Number(process.env.KINO_CONCURRENCY);
  if (Number.isFinite(env) && env >= 1) return Math.round(env);
  // Capture parallelism scales per browser process (see browser.ts), but each worker costs a
  // Chrome launch + page boot — only long renders amortize a big pool. Short clips keep 8;
  // 20s+ videos take up to 12. Leave one core for encode/extract.
  const cap = totalFrames > 600 ? 12 : 8;
  return Math.min(cap, Math.max(1, cpus().length - 1));
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
  shot: () => Promise<Buffer>;
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

async function workerPage(slot: number, browser: Browser, url: string, width: number, height: number): Promise<PageHandle> {
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
    await page.goto(`${url}/index.html`, { waitUntil: "load" });
    await awaitBoot(page);
    pageCache.set(slot, page);
  }
  const p = page;
  return {
    page: p,
    seek: async (frame: number) => {
      await p.evaluate(`window.kinoSeek(${frame})`);
    },
    shot: async () => Buffer.from(await p.screenshot({ type: "jpeg", quality: 95 })),
  };
}

// Stream ordered JPEG frames (q95 — Chrome's PNG encoder is ~10× slower per frame; the legacy
// engine's own frame format was JPEG) into a single libx264 encode (image2pipe on stdin) and mux
// the mixed audio track in the same pass. bt709 tags + matrix match players' expectations.
function startEncoder(opts: { fps: number; out: string; audio: string | null; preset: EncodePreset }): { stdin: NodeJS.WritableStream; done: Promise<void> } {
  const args = [
    "-y", "-loglevel", "error",
    "-f", "image2pipe", "-vcodec", "mjpeg", "-framerate", String(opts.fps), "-i", "-",
    ...(opts.audio ? ["-i", opts.audio] : []),
    "-map", "0:v", ...(opts.audio ? ["-map", "1:a"] : []),
    "-c:v", "libx264", "-preset", opts.preset, "-crf", "18",
    "-vf", "scale=out_color_matrix=bt709:out_range=tv",
    "-pix_fmt", "yuv420p",
    "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
    ...(opts.audio ? ["-c:a", "aac", "-b:a", "320k"] : []),
    "-movflags", "+faststart",
    opts.out,
  ];
  const proc = spawn(FFMPEG_PATH, args, { stdio: ["pipe", "ignore", "pipe"] });
  let stderr = "";
  proc.stderr.on("data", (d) => (stderr += d));
  const done = new Promise<void>((resolve, reject) => {
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg encode failed (${code}): ${stderr}`))));
    proc.on("error", reject);
  });
  return { stdin: proc.stdin, done };
}

const writeFrame = (stdin: NodeJS.WritableStream, buf: Buffer) =>
  new Promise<void>((resolve, reject) => {
    stdin.write(buf, (err) => (err ? reject(err) : resolve()));
  });

// Render frames [0, total) across `workers` pages into the encoder, in order. Workers claim the
// next frame index; a single drain loop writes each frame as soon as its predecessor shipped,
// with a bounded look-ahead so memory stays flat.
export async function renderFrameRange(
  handles: PageHandle[],
  total: number,
  stdin: NodeJS.WritableStream,
  cache?: { get(n: number): Promise<Buffer | null>; put(n: number, buf: Buffer): Promise<void> },
): Promise<void> {
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

  const workers = handles.map(async (h) => {
    for (;;) {
      if (failure) return;
      if (next >= total) return;
      if (next - written >= AHEAD) {
        await waitTick();
        continue;
      }
      const frame = next++;
      try {
        const cached = cache ? await cache.get(frame) : null;
        if (cached) {
          ready.set(frame, cached);
        } else {
          await h.seek(frame);
          const buf = await h.shot();
          ready.set(frame, buf);
          if (cache) await cache.put(frame, buf);
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

async function prepareDenseMedia(props: KinoProps, publicDir: string, scratch: string): Promise<PreparedMedia> {
  const framesDir = join(scratch, "vframes");
  mkdirSync(framesDir, { recursive: true });
  const jobs = planMediaJobs(props, props.fps);
  const media: Record<string, MediaEntryNode> = {};
  // Extraction is decode-bound; a small parallel pool keeps it off the critical path.
  const pool = 3;
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(pool, jobs.length) }, async () => {
      while (i < jobs.length) {
        const job = jobs[i++];
        media[job.key] = await extractDense(job, join(publicDir, job.assetRel), framesDir);
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
    }),
  });
}

export interface NativeRenderOpts {
  props: KinoProps;
  publicDir: string;
  formats: Array<"9:16" | "3:4" | "16:9">;
  outDir: string;
  title: string;
  preset?: EncodePreset; // veryfast for mock/preview builds; medium (default) for finals
}

export function renderVideoNative(opts: NativeRenderOpts): Promise<string[]> {
  return withRenderLock(() => renderVideoLocked(opts));
}

async function renderVideoLocked({ props, publicDir, formats, outDir, title, preset = "medium" }: NativeRenderOpts): Promise<string[]> {
  mkdirSync(outDir, { recursive: true });
  const scratch = mkdtempSync(join(tmpdir(), "kino-native-"));
  const t0 = Date.now();
  const lap = (m: string) => {
    if (process.env.KINO_NATIVE_DEBUG) console.error(`[native timing] ${m} +${Date.now() - t0}ms`);
  };
  // One browser PER WORKER — CDP screenshot capture serializes within a browser process, so
  // worker parallelism only pays off across processes.
  const total = durationInFrames(props);
  const n = Math.min(concurrency(total), total);
  const slots = Array.from({ length: n }, (_, i) => i);
  // Mock (veryfast) → SS=1 (~4× cheaper shader/glass fill) unless KINO_SHADER_SSAA overrides.
  const ss = resolveShaderSS(process.env, { mock: preset === "veryfast" });
  const fx = resolveShaderFXAA(process.env);
  const mode = glMode();
  try {
    const endSec = total / props.fps;
    // Browser launches overlap frame extraction + the audio mix — none depend on each other.
    const [{ framesDir, media }, audio, browsers] = await Promise.all([
      prepareDenseMedia(props, publicDir, scratch),
      buildAudioTrack(props, publicDir, endSec, scratch),
      Promise.all(slots.map((i) => acquireBrowser(i))),
    ]);
    lap("media+audio+browsers");

    const outputs: string[] = [];
    try {
      for (const fmt of formats) {
        const { width, height } = DIMS[fmt];
        const server = await pointServerAt({ props, publicDir, framesDir, media, width, height, total, shaderSS: ss, shaderFXAA: fx });
        const handles = await Promise.all(browsers.map((b, i) => workerPage(i, b, server.url, width, height)));
        lap(`pages-boot ${fmt}`);
        // Capture cache: unchanged beats reuse their stored JPEGs; only dirty frames hit Chrome.
        // mode + shaderSS are in the global sig so GPU/SW and SS=1/2 never cross-serve.
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
        });
        const cache = openFrameCache(join(outDir, ".frame-cache", fmt.replace(":", "x")), sigs);
        const tmpOut = join(scratch, `video-${fmt.replace(":", "x")}.mp4`);
        const enc = startEncoder({ fps: props.fps, out: tmpOut, audio, preset });
        await renderFrameRange(handles, total, enc.stdin, cache);
        lap(`frames ${fmt} (${cache.hits}/${total} cached)`);
        enc.stdin.end();
        await enc.done;
        cache.commit();
        lap(`encode-flush ${fmt}`);
        const out = join(outDir, `${title}-${fmt.replace(":", "x")}.mp4`);
        moveFile(tmpOut, out);
        outputs.push(out);
      }
    } finally {
      await Promise.all(slots.map((i) => releaseBrowser(i)));
    }
    return outputs;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// Deterministic layout geometry for one element (a `[data-measure]`-tagged node), so alignment is
// read as numbers instead of eyeballed off a screenshot. All px are frame px (viewport is set at
// deviceScaleFactor 1, so CSS px == canvas px); dxPct/dyPct are the signed offset of the element
// center from the frame center (0 = dead center).
export interface ElementMeasure {
  label: string;
  x: number; y: number; w: number; h: number;
  cx: number; cy: number;
  cxPct: number; cyPct: number;
  dxPct: number; dyPct: number;
}
export interface FrameMeasure {
  name: string;
  width: number; height: number;
  elements: ElementMeasure[];
}

// Serialized into the render page and run after a seek: walk the light DOM + every shadow root and
// report the geometry of each element carrying a `data-measure` attribute. Pure browser code (no
// Node refs) so puppeteer can .toString() it across the boundary.
function collectMeasurements(): { width: number; height: number; elements: ElementMeasure[] } {
  const W = window.innerWidth, H = window.innerHeight;
  const out: ElementMeasure[] = [];
  const walk = (root: Document | ShadowRoot): void => {
    root.querySelectorAll("[data-measure]").forEach((el) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
      out.push({
        label: el.getAttribute("data-measure") || el.tagName.toLowerCase(),
        x: r.x, y: r.y, w: r.width, h: r.height, cx, cy,
        cxPct: (cx / W) * 100, cyPct: (cy / H) * 100,
        dxPct: (cx / W) * 100 - 50, dyPct: (cy / H) * 100 - 50,
      });
    });
    root.querySelectorAll("*").forEach((el) => {
      const sr = (el as HTMLElement).shadowRoot;
      if (sr) walk(sr);
    });
  };
  walk(document);
  return { width: W, height: H, elements: out };
}

export interface NativeStillsOpts {
  props: KinoProps;
  publicDir: string;
  format: "9:16" | "3:4" | "16:9";
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
  const scratch = mkdtempSync(join(tmpdir(), "kino-native-still-"));
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
        for (const job of planMediaJobs(props, props.fps)) {
          const locals = wanted
            .map(({ frame }) => frame - job.fromFrame)
            .filter((local) => local >= 0 && local < job.seqDurFrames);
          if (!locals.length) continue;
          media[job.key] = await extractSparse(job, join(publicDir, job.assetRel), framesDir, locals);
        }
      })(),
    ]);

    const { width, height } = DIMS[format];
    try {
      const ss = resolveShaderSS(process.env);
      const fx = resolveShaderFXAA(process.env);
      const server = await pointServerAt({ props, publicDir, framesDir, media, width, height, total, shaderSS: ss, shaderFXAA: fx });
      const handle = await workerPage(0, browser, server.url, width, height);
      const outs: string[] = [];
      for (const { frame, name } of wanted) {
        await handle.seek(frame);
        const out = join(outDir, `${name}.png`);
        await handle.page.screenshot({ type: "png", path: out as `${string}.png` });
        outs.push(out);
        if (measureSink) {
          // String form avoids tsx __name injection on nested fns passed to puppeteer.
          const m = (await handle.page.evaluate(`(() => {
            const W = window.innerWidth, H = window.innerHeight;
            const out = [];
            function walk(root) {
              root.querySelectorAll("[data-measure]").forEach(function(el) {
                const r = el.getBoundingClientRect();
                const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
                out.push({
                  label: el.getAttribute("data-measure") || el.tagName.toLowerCase(),
                  x: r.x, y: r.y, w: r.width, h: r.height, cx: cx, cy: cy,
                  cxPct: (cx / W) * 100, cyPct: (cy / H) * 100,
                  dxPct: (cx / W) * 100 - 50, dyPct: (cy / H) * 100 - 50
                });
              });
              root.querySelectorAll("*").forEach(function(el) {
                const sr = el.shadowRoot;
                if (sr) walk(sr);
              });
            }
            walk(document);
            return { width: W, height: H, elements: out };
          })()`)) as { width: number; height: number; elements: ElementMeasure[] };
          measureSink.push({ name, width: m.width, height: m.height, elements: m.elements });
        }
      }
      return outs;
    } finally {
      await releaseBrowser(0);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
