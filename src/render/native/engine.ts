// Native render engine: headless-Chrome frame stepping → ffmpeg. Every frame is a pure function of
// its index (the page re-renders synchronously per seek; videos are pre-extracted stills; audio is
// mixed node-side), so the output is deterministic run-to-run. Public API mirrors render.ts.
import { spawn } from "node:child_process";
import { cpus, tmpdir } from "node:os";
import { copyFileSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Browser, Page } from "puppeteer";
import { FFMPEG_PATH } from "../../media/binPaths.js";
import type { Format } from "../../spec/schema.js";
import type { KinoProps } from "../props.js";
import { buildAudioTrack } from "./audioMix.js";
import { acquireBrowser, releaseBrowser } from "./browser.js";
import { frameSignatures, openFrameCache } from "./frameCache.js";
import { getPageBundle, getPageBundleHash } from "./pageBundle.js";
import { ensureRenderServer } from "./server.js";
import { extractDense, extractSparse, planMediaJobs, type MediaEntryNode } from "./videoFrames.js";
import { DIMS } from "../dims.js";

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
  // Chrome launch + page boot — only long renders amortize a big pool. Short clips (tests,
  // per-beat previews) keep 4; 20s+ videos take up to 8. Two cores stay free for encode/extract.
  const cap = totalFrames > 600 ? 8 : 4;
  return Math.min(cap, Math.max(1, cpus().length - 2));
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
  scene3dDir: string;
  media: Record<string, MediaEntryNode>;
  width: number;
  height: number;
  total: number;
}): Promise<{ url: string }> {
  const pageJs = await getPageBundle();
  return ensureRenderServer({
    publicDir: opts.publicDir,
    framesDir: opts.framesDir,
    scene3dDir: opts.scene3dDir,
    pageJs,
    renderConfigJson: JSON.stringify({
      props: opts.props,
      width: opts.width,
      height: opts.height,
      durationInFrames: opts.total,
      media: opts.media,
    }),
  });
}

export interface NativeRenderOpts {
  props: KinoProps;
  publicDir: string;
  scene3dDir: string;
  formats: Format[];
  outDir: string;
  title: string;
  preset?: EncodePreset; // veryfast for mock/preview builds; medium (default) for finals
}

export function renderVideoNative(opts: NativeRenderOpts): Promise<string[]> {
  return withRenderLock(() => renderVideoLocked(opts));
}

async function renderVideoLocked({ props, publicDir, scene3dDir, formats, outDir, title, preset = "medium" }: NativeRenderOpts): Promise<string[]> {
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
        const server = await pointServerAt({ props, publicDir, framesDir, scene3dDir, media, width, height, total });
        const handles = await Promise.all(browsers.map((b, i) => workerPage(i, b, server.url, width, height)));
        lap(`pages-boot ${fmt}`);
        // Capture cache: unchanged beats reuse their stored JPEGs; only dirty frames hit Chrome.
        // Keyed per encode preset — mock (veryfast) and final (medium) share captures fine, but the
        // cache lives beside the outputs, so a preview and a final build read the same store.
        const sigs = frameSignatures({ props, publicDir, pageJsHash: await getPageBundleHash(), width, height, total, fps: props.fps });
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

export interface NativeStillsOpts {
  props: KinoProps;
  publicDir: string;
  scene3dDir: string;
  format: Format;
  frames: Array<{ frame: number; name: string }>;
  outDir: string;
}

export function renderStillsNative(opts: NativeStillsOpts): Promise<string[]> {
  return withRenderLock(() => renderStillsLocked(opts));
}

async function renderStillsLocked({ props, publicDir, scene3dDir, format, frames, outDir }: NativeStillsOpts): Promise<string[]> {
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
      const server = await pointServerAt({ props, publicDir, framesDir, scene3dDir, media, width, height, total });
      const handle = await workerPage(0, browser, server.url, width, height);
      const outs: string[] = [];
      for (const { frame, name } of wanted) {
        await handle.seek(frame);
        const out = join(outDir, `${name}.png`);
        await handle.page.screenshot({ type: "png", path: out as `${string}.png` });
        outs.push(out);
      }
      return outs;
    } finally {
      await releaseBrowser(0);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
