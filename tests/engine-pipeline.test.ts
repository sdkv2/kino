import { describe, it, expect } from "vitest";
import { execa } from "execa";
import { FFMPEG_PATH } from "../src/media/binPaths.js";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderFrameRange, type PageHandle } from "../src/render/native/engine.js";
import { frameSignatures } from "../src/render/native/frameCache.js";
import { extractDense, type MediaJob } from "../src/render/native/videoFrames.js";
import type { KinoProps } from "../src/render/props.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Fake capture handle: shot() returns the last-sought frame index as bytes, with an optional
// per-frame delay so worker/drain wait patterns can be forced.
function fakeHandle(delayFor: (frame: number) => number): PageHandle {
  let at = -1;
  return {
    page: null as never,
    seek: async (frame) => {
      at = frame;
    },
    shot: async () => {
      const d = delayFor(at);
      if (d > 0) await sleep(d);
      return Buffer.from(String(at));
    },
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
      write(buf: Buffer, cb: (err?: Error | null) => void) {
        written.push(Number(buf.toString()));
        setTimeout(() => cb(null), 1);
        return true;
      },
    } as unknown as NodeJS.WritableStream;

    await renderFrameRange(handles, total, stdin);
    expect(written).toEqual(Array.from({ length: total }, (_, i) => i));
  }, 30000);

  it("propagates a worker failure instead of hanging", async () => {
    const bad: PageHandle = {
      page: null as never,
      seek: async () => {},
      shot: async () => {
        throw new Error("boom");
      },
    };
    const stdin = {
      write(_buf: Buffer, cb: (err?: Error | null) => void) {
        cb(null);
        return true;
      },
    } as unknown as NodeJS.WritableStream;
    await expect(renderFrameRange([bad], 10, stdin)).rejects.toThrow("boom");
  });
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

  it("renderFrameRange serves cached frames without touching the page and stores misses", async () => {
    const total = 60;
    const seeks: number[] = [];
    const handle: PageHandle = {
      page: null as never,
      seek: async (f) => {
        seeks.push(f);
      },
      shot: async () => Buffer.from("fresh"),
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
      write(buf: Buffer, cb: (err?: Error | null) => void) {
        written.push(buf.toString());
        cb(null);
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
});
