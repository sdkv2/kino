import { describe, it, expect } from "vitest";
import { planMaskJobs } from "../src/render/native/videoFrames.js";
import type { KinoProps, KinoSegment } from "../src/render/props.js";

const theme = {
  font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64",
  gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9,
};
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
});
