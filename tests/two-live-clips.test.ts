// Two live clips in one frame (#28) — planning + layer emission. Split-screen / PiP is
// expressed as two declared video layers with different z and rects: each gets its own /vframes
// job (planMediaJobs keys by layer id) and its own LayerDraw at the same composition frame.
// Node env (no DOM): the registry half lives in tests/two-live-clips-registry.test.ts, which
// needs jsdom because buildRegistry creates a Canvas2D source for a glow background.
import { describe, it, expect } from "vitest";
import { planMediaJobs } from "../src/render/native/videoFrames.js";
import { layersAt } from "../src/render/layers.js";
import type { KinoProps } from "../src/render/props.js";

const theme = { font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64", gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9, film: 0 } as unknown as import("../src/render/props.js").Theme;
const bg = { kind: "glow" as const, image: null, customCode: null, shaderCode: null, params: {}, keyframes: [], triggers: [] };
const DIMS = { width: 1080, height: 1920 };

// Two video layers that overlap in time: a full-bleed background clip and a PiP inset on top.
const props = (): KinoProps => ({
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, background: bg, disclosure: "",
  segments: [{ kind: "scene", caption: "hi", startSec: 0, endSec: 4 }],
  layers: [
    { id: "bg", z: 300, source: { kind: "video", src: "bg.mp4", url: "bg.mp4" } },
    {
      id: "pip", z: 450,
      source: { kind: "video", src: "pip.mp4", url: "pip.mp4" },
      rect: { x: 60, y: 55, w: 35, h: 40 },
      fromSec: 1, toSec: 3,
    },
  ],
});

describe("two live clips in one frame", () => {
  it("plans an independent extraction job per video layer", () => {
    const jobs = planMediaJobs(props(), 30);
    const keys = jobs.map((j) => j.key);
    expect(keys).toContain("bg");
    expect(keys).toContain("pip");
    // Both jobs run concurrently (independent clips, independent clocks).
    expect(jobs.find((j) => j.key === "bg")!.startSec).toBe(0);
    expect(jobs.find((j) => j.key === "pip")!.fromFrame).toBe(30); // 1s
    expect(jobs.find((j) => j.key === "pip")!.seqDurFrames).toBe(60); // 1..3s
  });

  it("emits both layers at a frame where they overlap", () => {
    const layers = layersAt(props(), 45, DIMS); // 1.5s — inside the PiP window
    const ids = layers.filter((l) => l.id === "bg" || l.id === "pip").map((l) => l.id);
    expect(ids).toEqual(["bg", "pip"]);
  });

  it("emits only the background clip outside the PiP window", () => {
    const layers = layersAt(props(), 5, DIMS); // ~0.17s — before the PiP starts
    const ids = layers.filter((l) => l.id === "bg" || l.id === "pip").map((l) => l.id);
    expect(ids).toEqual(["bg"]);
  });

  it("keeps the PiP rect — the inset clips are separate layers, not a beat stack", () => {
    const layers = layersAt(props(), 45, DIMS);
    const pip = layers.find((l) => l.id === "pip")!;
    expect(pip.rect).toEqual({ x: (60 / 100) * 1080, y: (55 / 100) * 1920, w: (35 / 100) * 1080, h: (40 / 100) * 1920 });
  });
});
