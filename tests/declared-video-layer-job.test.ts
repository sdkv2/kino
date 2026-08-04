// Declared video layers get /vframes jobs (#24). A declared layer with a real footage source
// (mp4/mov) must be extracted like a seg{i} beat — keyed by the layer's own id so registry.ts can
// bind `media[d.id]` — while a declared video layer pointed at a still image is not extracted
// (registry falls back to createImageSource on the staged file, exactly like a still seg beat).
import { describe, it, expect } from "vitest";
import { planMediaJobs } from "../src/render/native/videoFrames.js";
import type { KinoProps } from "../src/render/props.js";

const theme = { font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64", gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9, film: 0 } as unknown as import("../src/render/props.js").Theme;
const bg = { kind: "glow" as const, image: null, customCode: null, shaderCode: null, params: {}, keyframes: [], triggers: [] };

const propsWith = (layers: NonNullable<KinoProps["layers"]>): KinoProps => ({
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, background: bg, disclosure: "",
  layers,
  segments: [{ kind: "scene", caption: "hi", startSec: 0, endSec: 3 }],
});

describe("declared video layer media jobs", () => {
  it("plans a job keyed by the layer id for a footage layer", () => {
    const jobs = planMediaJobs(propsWith([
      { id: "pip", z: 450, source: { kind: "video", src: "clip.mp4", url: "clip.mp4" }, rect: { x: 60, y: 60, w: 30, h: 30 }, fromSec: 0.5, toSec: 2.5 },
    ]), 30);
    const job = jobs.find((j) => j.key === "pip");
    expect(job).toBeDefined();
    expect(job!.assetRel).toBe("clip.mp4");
    expect(job!.fromFrame).toBe(15); // 0.5s
    expect(job!.seqDurFrames).toBe(60); // 2s window
    expect(job!.startSec).toBe(0);
    expect(job!.stepSec).toBeCloseTo(1 / 30, 9);
    expect(job!.effFrame(7)).toBe(7);
    expect(job!.maxEffFrame).toBe(59);
  });

  it("borrows the bound segment's window when `segment` is set", () => {
    const jobs = planMediaJobs(propsWith([
      { id: "pip", z: 450, segment: 0, source: { kind: "video", src: "clip.mp4", url: "clip.mp4" } },
    ]), 30);
    const job = jobs.find((j) => j.key === "pip");
    expect(job!.fromFrame).toBe(0);
    expect(job!.seqDurFrames).toBe(90); // the 3s beat
  });

  it("defaults to the whole composition when no window is given", () => {
    const jobs = planMediaJobs(propsWith([
      { id: "pip", z: 450, source: { kind: "video", src: "clip.mp4", url: "clip.mp4" } },
    ]), 30);
    expect(jobs.find((j) => j.key === "pip")!.seqDurFrames).toBe(90);
  });

  it("does not extract a declared video layer pointed at a still image", () => {
    const jobs = planMediaJobs(propsWith([
      { id: "still", z: 450, source: { kind: "video", src: "notes.png", url: "notes.png" } },
    ]), 30);
    expect(jobs.some((j) => j.key === "still")).toBe(false);
  });

  it("plans nothing for non-video declared layers", () => {
    const jobs = planMediaJobs(propsWith([
      { id: "img", z: 450, source: { kind: "image", src: "a.png", url: "a.png" } },
      { id: "adj", z: 700, adjust: [{ kind: "grade", params: {} }] },
    ]), 30);
    expect(jobs.some((j) => j.key === "img" || j.key === "adj")).toBe(false);
  });

  it("coexists with segment and avatar jobs without key collisions", () => {
    const jobs = planMediaJobs({
      ...propsWith([{ id: "pip", z: 450, source: { kind: "video", src: "clip.mp4", url: "clip.mp4" } }]),
      avatar: "presenter.mp4",
      avatarWindows: [{ fromSec: 0, toSec: 1, audioStartSec: 0 }],
      segments: [{ kind: "video", source: "beat.mp4", caption: "", startSec: 0, endSec: 1 }],
    }, 30);
    const keys = jobs.map((j) => j.key).sort();
    expect(keys).toContain("pip");
    expect(keys).toContain("av0");
    expect(keys).toContain("seg0");
    expect(new Set(keys).size).toBe(keys.length);
  });
});
