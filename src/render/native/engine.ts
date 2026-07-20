// Native render engine: headless-Chrome frame stepping → ffmpeg. Every frame is a pure function of
// its index (the page re-renders synchronously per seek; videos are pre-extracted stills; audio is
// mixed node-side), so the output is deterministic run-to-run. Public API mirrors render.ts.
import { spawn } from "node:child_process";
import { cpus, tmpdir } from "node:os";
import { mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Browser, Page } from "puppeteer";
import type { KinoProps } from "../props.js";
import { buildAudioTrack } from "./audioMix.js";
import { launchBrowser } from "./browser.js";
import { getPageBundle } from "./pageBundle.js";
import { startRenderServer, type RenderServer } from "./server.js";
import { extractDense, extractSparse, planMediaJobs, type MediaEntryNode } from "./videoFrames.js";

const DIMS: Record<string, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "3:4": { width: 1080, height: 1440 },
};

// Composition length contract (matches the legacy calculateMetadata): last segment end, or a
// 30-second default when there are no segments.
function durationInFrames(props: KinoProps): number {
  const total = props.segments.length ? Math.max(...props.segments.map((s) => s.endSec)) : 30;
  return Math.max(1, Math.round(total * props.fps));
}

function concurrency(): number {
  const env = Number(process.env.KINO_CONCURRENCY);
  if (Number.isFinite(env) && env >= 1) return Math.round(env);
  return Math.min(4, Math.max(1, cpus().length - 1));
}

interface PageHandle {
  page: Page;
  seek: (frame: number) => Promise<void>;
  shot: () => Promise<Buffer>;
}

async function openRenderPage(browser: Browser, url: string, width: number, height: number): Promise<PageHandle> {
  const page = await browser.newPage();
  if (process.env.KINO_NATIVE_DEBUG) {
    page.on("console", (m) => console.error(`[native page ${m.type()}] ${m.text().slice(0, 500)}`));
    page.on("pageerror", (e) => console.error(`[native pageerror] ${e.message}`));
    page.on("requestfailed", (r) => console.error(`[native reqfail] ${r.url()} ${r.failure()?.errorText}`));
  }
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.goto(`${url}/index.html`, { waitUntil: "load" });
  // Poll from node (each evaluate is a direct CDP call) — in-page rAF/timer polling is throttled
  // on background tabs, and every worker page but the frontmost one is a background tab.
  const deadline = Date.now() + 60000;
  for (;;) {
    const state = (await page.evaluate("window.__kinoError ?? (window.__kinoReady === true)")) as string | boolean;
    if (typeof state === "string") throw new Error(`native render page failed to boot:\n${state}`);
    if (state === true) break;
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
  return {
    page,
    seek: async (frame: number) => {
      await page.evaluate(`window.kinoSeek(${frame})`);
    },
    shot: async () => Buffer.from(await page.screenshot({ type: "png" })),
  };
}

// Stream ordered PNG frames into a single libx264 encode (image2pipe on stdin) and mux the mixed
// audio track in the same pass. bt709 tags + matrix match broadcast/players' expectations.
function startEncoder(opts: { fps: number; out: string; audio: string | null }): { stdin: NodeJS.WritableStream; done: Promise<void> } {
  const args = [
    "-y", "-loglevel", "error",
    "-f", "image2pipe", "-vcodec", "png", "-framerate", String(opts.fps), "-i", "-",
    ...(opts.audio ? ["-i", opts.audio] : []),
    "-map", "0:v", ...(opts.audio ? ["-map", "1:a"] : []),
    "-c:v", "libx264", "-preset", "medium", "-crf", "18",
    "-vf", "scale=out_color_matrix=bt709:out_range=tv",
    "-pix_fmt", "yuv420p",
    "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
    ...(opts.audio ? ["-c:a", "aac", "-b:a", "320k"] : []),
    "-movflags", "+faststart",
    opts.out,
  ];
  const proc = spawn("ffmpeg", args, { stdio: ["pipe", "ignore", "pipe"] });
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
async function renderFrameRange(handles: PageHandle[], total: number, stdin: NodeJS.WritableStream): Promise<void> {
  const AHEAD = 48; // max undrained frames in memory
  const ready = new Map<number, Buffer>();
  let next = 0; // next frame index to claim
  let written = 0; // next frame index to write
  let failure: Error | null = null;
  let wake: (() => void) | null = null;
  const notify = () => {
    wake?.();
    wake = null;
  };
  const waitTick = () => new Promise<void>((resolve) => (wake = resolve));

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
        await h.seek(frame);
        ready.set(frame, await h.shot());
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

async function startServer(opts: {
  props: KinoProps;
  publicDir: string;
  framesDir: string;
  media: Record<string, MediaEntryNode>;
  width: number;
  height: number;
  total: number;
}): Promise<RenderServer> {
  const pageJs = await getPageBundle();
  return startRenderServer({
    publicDir: opts.publicDir,
    framesDir: opts.framesDir,
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
  formats: Array<"9:16" | "3:4">;
  outDir: string;
  title: string;
}

export async function renderVideoNative({ props, publicDir, formats, outDir, title }: NativeRenderOpts): Promise<string[]> {
  mkdirSync(outDir, { recursive: true });
  const scratch = mkdtempSync(join(tmpdir(), "kino-native-"));
  try {
    const total = durationInFrames(props);
    const endSec = total / props.fps;
    const [{ framesDir, media }, audio] = await Promise.all([
      prepareDenseMedia(props, publicDir, scratch),
      buildAudioTrack(props, publicDir, endSec, scratch),
    ]);

    const outputs: string[] = [];
    for (const fmt of formats) {
      const { width, height } = DIMS[fmt];
      const server = await startServer({ props, publicDir, framesDir, media, width, height, total });
      const browser = await launchBrowser();
      try {
        const n = Math.min(concurrency(), total);
        const handles = await Promise.all(Array.from({ length: n }, () => openRenderPage(browser, server.url, width, height)));
        const tmpOut = join(scratch, `video-${fmt.replace(":", "x")}.mp4`);
        const enc = startEncoder({ fps: props.fps, out: tmpOut, audio });
        await renderFrameRange(handles, total, enc.stdin);
        enc.stdin.end();
        await enc.done;
        const out = join(outDir, `${title}-${fmt.replace(":", "x")}.mp4`);
        renameSync(tmpOut, out);
        outputs.push(out);
      } finally {
        await browser.close();
        await server.close();
      }
    }
    return outputs;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export interface NativeStillsOpts {
  props: KinoProps;
  publicDir: string;
  format: "9:16" | "3:4";
  frames: Array<{ frame: number; name: string }>;
  outDir: string;
}

export async function renderStillsNative({ props, publicDir, format, frames, outDir }: NativeStillsOpts): Promise<string[]> {
  mkdirSync(outDir, { recursive: true });
  const scratch = mkdtempSync(join(tmpdir(), "kino-native-still-"));
  try {
    const total = durationInFrames(props);
    const maxFrame = total - 1;
    const wanted = frames.map(({ frame, name }) => ({ frame: Math.min(maxFrame, Math.max(0, frame)), name }));

    // Sparse extraction: only the video frames these stills actually show.
    const framesDir = join(scratch, "vframes");
    mkdirSync(framesDir, { recursive: true });
    const jobs = planMediaJobs(props, props.fps);
    const media: Record<string, MediaEntryNode> = {};
    for (const job of jobs) {
      const locals = wanted
        .map(({ frame }) => frame - job.fromFrame)
        .filter((local) => local >= 0 && local < job.seqDurFrames);
      if (!locals.length) continue;
      media[job.key] = await extractSparse(job, join(publicDir, job.assetRel), framesDir, locals);
    }

    const { width, height } = DIMS[format];
    const server = await startServer({ props, publicDir, framesDir, media, width, height, total });
    const browser = await launchBrowser();
    try {
      const handle = await openRenderPage(browser, server.url, width, height);
      const outs: string[] = [];
      for (const { frame, name } of wanted) {
        await handle.seek(frame);
        const out = join(outDir, `${name}.png`);
        await handle.page.screenshot({ type: "png", path: out as `${string}.png` });
        outs.push(out);
      }
      return outs;
    } finally {
      await browser.close();
      await server.close();
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
