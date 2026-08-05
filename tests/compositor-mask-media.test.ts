import { describe, it, expect } from "vitest";
import { planMaskJobs } from "../src/render/native/videoFrames.js";
import type { KinoProps, KinoSegment } from "../src/render/props.js";

const theme = {
  font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64",
  gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9,
} as unknown as import("../src/render/props.js").Theme;
const bg = { kind: "glow" as const, image: null, customCode: null, shaderCode: null, params: {}, keyframes: [], triggers: [] };

const withMask = (mask: unknown): KinoProps => ({
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null,
  background: bg, disclosure: "",
  segments: [{ kind: "video", caption: "", startSec: 0, endSec: 2, source: "clip.mp4", mask } as unknown as KinoSegment],
});

describe("planMaskJobs", () => {
  it("plans a media job for a video mask", () => {
    const jobs = planMaskJobs(withMask({ source: { kind: "file", src: "m.mp4", channel: "r" } }), 30);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].key).toMatch(/^lmask/);
    expect(jobs[0].assetRel).toBe("m.mp4");
  });

  it("plans nothing for a shape mask — no file to extract", () => {
    expect(planMaskJobs(withMask({ source: { kind: "shape", shape: { kind: "rect", x: 0, y: 0, w: 10, h: 10 } } }), 30)).toEqual([]);
  });

  it("plans nothing for a layer mask — the source is another layer, not a file", () => {
    expect(planMaskJobs(withMask({ source: { kind: "layer", layerId: "motion0", channel: "luma" } }), 30)).toEqual([]);
  });

  it("spans the masked beat's frames", () => {
    const jobs = planMaskJobs(withMask({ source: { kind: "file", src: "m.mp4", channel: "r" } }), 30);
    expect(jobs[0].fromFrame).toBe(0);
    expect(jobs[0].seqDurFrames).toBe(60);
  });

  it("plans a job for a declared layer's file mask, keyed by the layer id", () => {
    const p: KinoProps = {
      theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null,
      background: bg, disclosure: "",
      segments: [{ kind: "scene", caption: "hi", startSec: 0, endSec: 3 } as unknown as KinoSegment],
      layers: [{ id: "cutout", z: 450, source: { kind: "image", src: "a.png", url: "a.png" }, mask: { source: { kind: "file", src: "masks/subject/mask.mp4", channel: "r" } } }],
    };
    const jobs = planMaskJobs(p, 30);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].key).toBe("lmask-cutout");
    expect(jobs[0].assetRel).toBe("masks/subject/mask.mp4");
  });

  it("uses the declared layer's window (segment binding / fromSec-toSec)", () => {
    const p: KinoProps = {
      theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null,
      background: bg, disclosure: "",
      segments: [{ kind: "scene", caption: "hi", startSec: 0, endSec: 3 } as unknown as KinoSegment],
      layers: [{ id: "cutout", z: 450, segment: 0, source: { kind: "image", src: "a.png", url: "a.png" }, mask: { source: { kind: "file", src: "m.mp4", channel: "a" } } }],
    };
    const jobs = planMaskJobs(p, 30);
    expect(jobs[0].fromFrame).toBe(0);
    expect(jobs[0].seqDurFrames).toBe(90);
  });

  it("classifies lmask jobs as mask extractions (PNG format with SDF twin)", async () => {
    const { planDense } = await import("../src/render/native/videoFrames.js");
    const job = planMaskJobs(withMask({ source: { kind: "file", src: "m.mp4", channel: "a" } }), 30)[0];
    const planned = await planDense(job, "nonexistent.mp4", "/tmp/frames");
    // Non-existent source yields empty byFrame/maxFrame=0, but the planned manifest format
    // is configured by job.key namespace — lmask must produce dir matching job.key
    expect(planned.entry.dir).toBe("lmask0");
  });
});
