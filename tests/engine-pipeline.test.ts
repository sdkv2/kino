import { describe, it, expect } from "vitest";
import { execa } from "execa";
import { FFMPEG_PATH } from "../src/media/binPaths.js";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderFrameRange, startEncoder } from "../src/render/native/engine.js";
import type { WorkerHandle } from "../src/render/native/workerHandle.js";
import { frameSignatures } from "../src/render/native/frameCache.js";
import { extractDense, type MediaJob } from "../src/render/native/videoFrames.js";
import type { KinoProps } from "../src/render/props.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Pipeline capture returns the previous frame's JPEG; fake handles model synchronous capture.
beforeAll(() => {
  process.env.KINO_CAPTURE_PIPELINE = "0";
});
afterAll(() => {
  delete process.env.KINO_CAPTURE_PIPELINE;
});

// Fake capture handle: shot() returns the last-sought frame index as bytes, with an optional
// per-frame delay so worker/drain wait patterns can be forced.
function fakeHandle(delayFor: (frame: number) => number): WorkerHandle {
  let at = -1;
  return {
    seekAndCapture: async (frame) => {
      at = frame;
      const d = delayFor(at);
      if (d > 0) await sleep(d);
      return Buffer.from(String(at));
    },
    flush: async () => null,
  };
}

describe("renderFrameRange", () => {
  // Regression: the drain/worker wake used a single resolver slot, so concurrent waiters (workers
  // parked at the look-ahead limit while the drain waited on a straggler frame) overwrote each
  // other and the pipeline deadlocked at 0% CPU. This workload forces that pattern: fast workers
  // sprint to the AHEAD limit and park while every 40th frame stalls the drain.
  it("completes with mixed frame costs and slow writes (no lost-wakeup deadlock)", async () => {
    const total = 400;
    const handles = Array.from({ length: 8 }, () => fakeHandle((f) => (f % 40 === 0 ? 25 : 0)));
    const written: number[] = [];
    const stdin = {
      write(buf: Buffer, cb?: (err?: Error | null) => void) {
        written.push(Number(buf.toString()));
        if (typeof cb === "function") setTimeout(() => cb(null), 1);
        return true;
      },
    } as unknown as NodeJS.WritableStream;

    await renderFrameRange(handles, total, stdin);
    expect(written).toEqual(Array.from({ length: total }, (_, i) => i));
  }, 30000);

  it("propagates a worker failure instead of hanging", async () => {
    const bad: WorkerHandle = {
      seekAndCapture: async () => {
        throw new Error("boom");
      },
      flush: async () => null,
    };
    const stdin = {
      write(_buf: Buffer, cb: (err?: Error | null) => void) {
        cb(null);
        return true;
      },
    } as unknown as NodeJS.WritableStream;
    await expect(renderFrameRange([bad], 10, stdin)).rejects.toThrow("boom");
  });

  // Regression: the worker's terminal branch (next >= total) stored the final lagging frame via
  // storeLag but returned without notify(), so a drain parked in waitTick() never woke — deadlock
  // only in pipeline mode, where flush is the sole producer of the last frame. Force that race:
  // one worker, last seek + flush slow enough that drain parks before the final store lands.
  it("completes when final pipelined flush lands while drain is parked (no lost-wakeup deadlock)", async () => {
    const total = 20;
    let pending: Buffer | null = null;
    const handle: WorkerHandle = {
      seekAndCapture: async (frame) => {
        if (frame === total - 1) await sleep(40);
        const prev = pending;
        pending = Buffer.from(String(frame));
        return prev;
      },
      flush: async () => {
        await sleep(40);
        const last = pending;
        pending = null;
        return last;
      },
    };
    const written: number[] = [];
    const stdin = {
      write(buf: Buffer, cb?: (err?: Error | null) => void) {
        written.push(Number(buf.toString()));
        if (typeof cb === "function") cb(null);
        return true;
      },
    } as unknown as NodeJS.WritableStream;

    await renderFrameRange([handle], total, stdin, undefined, { pipeline: true });
    expect(written).toEqual(Array.from({ length: total }, (_, i) => i));
  }, 5000);
});

describe("frame cache", () => {
  const props = (segs: Array<Record<string, unknown>>) =>
    ({ fps: 30, segments: segs } as unknown as KinoProps);
  const sigOpts = { publicDir: "/nowhere", pageJsHash: "pj", width: 1080, height: 1920, total: 300, fps: 30 };

  it("editing one segment invalidates only its padded frame range", () => {
    const a = frameSignatures({ ...sigOpts, props: props([
      { kind: "motion", startSec: 0, endSec: 5, proc: "one" },
      { kind: "motion", startSec: 5, endSec: 10, proc: "two" },
    ]) });
    const b = frameSignatures({ ...sigOpts, props: props([
      { kind: "motion", startSec: 0, endSec: 5, proc: "one" },
      { kind: "motion", startSec: 5, endSec: 10, proc: "two EDITED" },
    ]) });
    // Segment 2 spans frames 150–300 with a 30-frame pad → frames < 120 keep their signature.
    for (let n = 0; n < 120; n++) expect(b[n]).toBe(a[n]);
    for (let n = 120; n < 300; n++) expect(b[n]).not.toBe(a[n]);
  });

  it("a global change (dimensions) invalidates every frame", () => {
    const segs = [{ kind: "motion", startSec: 0, endSec: 10, proc: "one" }];
    const a = frameSignatures({ ...sigOpts, props: props(segs) });
    const b = frameSignatures({ ...sigOpts, width: 720, props: props(segs) });
    for (let n = 0; n < 300; n++) expect(b[n]).not.toBe(a[n]);
  });

  // The gpu/sw axis is gone with puppeteer: the Electron host forces its own ANGLE backend per
  // platform and there is no longer a knob that changes it mid-install. shaderSS remains a real
  // pixel axis and still has to split the key.
  it("shaderSS splits the global signature", () => {
    const segs = [{ kind: "motion", startSec: 0, endSec: 10, proc: "one" }];
    const base = { ...sigOpts, props: props(segs) };
    const full = frameSignatures({ ...base, shaderSS: 2 });
    const draft = frameSignatures({ ...base, shaderSS: 1 });
    for (let n = 0; n < 300; n++) expect(draft[n]).not.toBe(full[n]);
    expect(frameSignatures({ ...base, shaderSS: 2 })[0]).toBe(full[0]);
  });

  it("renderFrameRange serves cached frames without touching the page and stores misses", async () => {
    const total = 60;
    const seeks: number[] = [];
    const handle: WorkerHandle = {
      seekAndCapture: async (f) => {
        seeks.push(f);
        return Buffer.from("fresh");
      },
      flush: async () => null,
    };
    const stored = new Map<number, Buffer>();
    for (let n = 0; n < 30; n++) stored.set(n, Buffer.from("cached"));
    const cache = {
      get: async (n: number) => stored.get(n) ?? null,
      put: async (n: number, buf: Buffer) => {
        stored.set(n, buf);
      },
    };
    const written: string[] = [];
    const stdin = {
      write(buf: Buffer, cb?: (err?: Error | null) => void) {
        written.push(buf.toString());
        if (typeof cb === "function") cb(null);
        return true;
      },
    } as unknown as NodeJS.WritableStream;

    await renderFrameRange([handle], total, stdin, cache);
    expect(written.length).toBe(total);
    expect(written.slice(0, 30).every((b) => b === "cached")).toBe(true);
    expect(written.slice(30).every((b) => b === "fresh")).toBe(true);
    expect(Math.min(...seeks)).toBe(30); // cached frames never reached the page
    expect(stored.size).toBe(total); // misses were stored
  });
});

describe("extractDense chunking", () => {
  // Regression: ffmpeg 8's expression parser rejects select filters past ~100 chained between()
  // terms ("Cannot allocate memory"). A 200-frame dense job needs >64 terms, so this exercises
  // the chunked extraction and the -start_number output mapping across chunk boundaries.
  it("extracts a dense 200-frame run across multiple select chunks", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-chunk-"));
    const video = join(dir, "src.mp4");
    await execa(FFMPEG_PATH, ["-y", "-loglevel", "error",
      "-f", "lavfi", "-i", "testsrc=duration=6.7:size=320x240:rate=30", "-pix_fmt", "yuv420p", video]);

    const total = 200;
    const job: MediaJob = {
      key: "seg0",
      assetRel: "src.mp4",
      fromFrame: 0,
      seqDurFrames: total,
      startSec: 0,
      stepSec: 1 / 30,
      effFrame: (n) => n,
      maxEffFrame: total - 1,
    };
    const framesRoot = join(dir, "vframes");
    const entry = await extractDense(job, video, framesRoot);

    const files = readdirSync(join(framesRoot, "seg0")).filter((f) => f.endsWith(".jpg"));
    expect(files.length).toBe(total);
    expect(Object.keys(entry.byFrame).length).toBe(total);
    // Chunk-boundary mapping: local frame ↔ source frame stays 1:1 for a same-rate dense run,
    // so the Nth frame maps to the Nth extracted file on both sides of the 64-frame chunk edges.
    for (const n of [0, 63, 64, 127, 128, 199]) {
      expect(entry.byFrame[n]).toBe(`x${String(n + 1).padStart(6, "0")}.jpg`);
    }
  }, 30000);

  // Mask jobs (and ONLY mask jobs) extract to lossless PNG: kinoMaskDist reads a coverage gradient,
  // and JPEG quantization perturbs the rendered distance field on the rim — 166 px of a 1080x1920
  // frame moved by up to 0.208 in a measured A/B render. Footage stays on JPEG q2, which the test
  // above pins. The two halves are one `job.key.startsWith("rsmask")` branch, so pin both sides:
  it("extracts mask jobs to png and leaves footage on jpg", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-maskext-"));
    const video = join(dir, "src.mp4");
    await execa(FFMPEG_PATH, ["-y", "-loglevel", "error",
      "-f", "lavfi", "-i", "testsrc=duration=1:size=320x240:rate=30", "-pix_fmt", "yuv420p", video]);

    const total = 10;
    const job = (key: string): MediaJob => ({
      key, assetRel: "src.mp4", fromFrame: 0, seqDurFrames: total,
      startSec: 0, stepSec: 1 / 30, effFrame: (n) => n, maxEffFrame: total - 1,
    });
    const framesRoot = join(dir, "vframes");
    const mask = await extractDense(job("rsmask0_0"), video, framesRoot);
    const footage = await extractDense(job("seg0"), video, framesRoot);

    const maskFiles = readdirSync(join(framesRoot, "rsmask0_0"));
    expect(maskFiles.every((f) => f.endsWith(".png"))).toBe(true);
    expect(Object.keys(mask.byFrame).length).toBe(total);
    expect(mask.byFrame[0]).toBe("x000001.png");

    // Mask jobs also get a precomputed signed distance field per frame, written alongside as s*.png
    // and indexed by sdfByFrame — that is what makes kinoMaskDist one exact tap instead of a
    // 24-tap search that facets past ~10px.
    expect(maskFiles.filter((f) => f.startsWith("s")).length).toBe(total);
    expect(mask.sdfByFrame?.[0]).toBe("s000001.png");
    expect(Object.keys(mask.sdfByFrame ?? {}).length).toBe(total);
    // Footage must NOT pay for a field it never reads.
    expect(footage.sdfByFrame).toBeUndefined();

    expect(readdirSync(join(framesRoot, "seg0")).every((f) => f.endsWith(".jpg"))).toBe(true);
    expect(footage.byFrame[0]).toBe("x000001.jpg");
  }, 30000);
});

describe("startEncoder failure semantics", () => {
  // Regression: an upstream capture failure tore the encoder down via kill(), and the SIGKILLed
  // ffmpeg's `done` rejection — never observed on that path — crashed the process as an unhandled
  // rejection. Every render failure then printed as `ffmpeg encode failed (null):` (empty stderr,
  // no user frames), masking the error that actually caused the teardown.
  it("kill() rejects done with the signal, without an unhandled rejection", async () => {
    const rejections: unknown[] = [];
    const onUnhandled = (r: unknown) => rejections.push(r);
    process.on("unhandledRejection", onUnhandled);
    try {
      const dir = mkdtempSync(join(tmpdir(), "kino-enc-"));
      const enc = startEncoder({ fps: 30, out: join(dir, "out.mp4"), audio: null, preset: "veryfast", captureCodec: "h264" });
      enc.kill();
      await expect(enc.done).rejects.toThrow(/ffmpeg encode failed \((SIGKILL|\d+)\)/);
      // Writes racing the teardown must not re-throw the pipe error as an uncaught exception —
      // the exit reason is the report, the broken pipe is just its echo.
      enc.stdin.write(Buffer.from("late frame"));
      await new Promise((r) => setTimeout(r, 100));
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  }, 15000);

  it("a real encode failure carries ffmpeg's stderr in the rejection", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-enc-"));
    const enc = startEncoder({ fps: 30, out: join(dir, "out.mp4"), audio: null, preset: "veryfast", captureCodec: "h264" });
    // Not annex-B H.264 — the h264 demuxer errors out and the exit must report why.
    enc.stdin.write(Buffer.from("definitely not an access unit"));
    enc.stdin.end();
    // Exit code, not a signal (nobody killed it), and a non-empty diagnostic after the colon.
    await expect(enc.done).rejects.toThrow(/ffmpeg encode failed \(\d+\): \S/);
  }, 15000);
});
