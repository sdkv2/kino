import { describe, it, expect } from "vitest";
import { inspectPlan, parseTimes, pickFrames, pickIntervalTimes } from "../src/render/preview.js";
import type { KinoProps } from "../src/render/props.js";

const props = {
  fps: 30,
  avatar: null,
  background: { kind: "mesh", image: null, customCode: null, colors: [], intensity: 0.5 },
  segments: [
    { kind: "avatar", caption: "hi", startSec: 0, endSec: 2 },
    { kind: "app", asset: "x.png", caption: "a", startSec: 2.3, endSec: 5, kicker: { text: "86%", color: "#1", fg: "#0" }, captionMode: "words" },
  ],
} as unknown as KinoProps;

describe("inspectPlan", () => {
  it("summarises the resolved render plan", () => {
    const p = inspectPlan(props);
    expect(p).toMatchObject({ fps: 30, faceless: true, background: "mesh" });
    expect(p.durationSec).toBeCloseTo(5);
    expect(p.segments[0]).toMatchObject({ index: 0, kind: "avatar", startSec: 0, endSec: 2, durSec: 2, captionMode: "phrase", hasKicker: false });
    expect(p.segments[1]).toMatchObject({ index: 1, kind: "app", asset: "x.png", captionMode: "words", hasKicker: true });
  });
});

describe("parseTimes", () => {
  it("parses a comma list of seconds, dropping junk", () => {
    expect(parseTimes("1,3.5,9")).toEqual([1, 3.5, 9]);
    expect(parseTimes("0, 2.2 , x, 4")).toEqual([0, 2.2, 4]);
  });
});

describe("pickFrames", () => {
  const segs = [
    { kind: "avatar", startSec: 0, endSec: 2 },
    { kind: "app", startSec: 2.3, endSec: 5 },
  ];
  it("at-list → one frame per timestamp", () => {
    expect(pickFrames(segs, 30, { at: [1, 4] })).toEqual([
      { frame: 30, label: "1s" },
      { frame: 120, label: "4s" },
    ]);
  });
  it("segment → the midpoint frame of that segment", () => {
    expect(pickFrames(segs, 30, { segment: 1 })).toEqual([{ frame: Math.round(3.65 * 30), label: "1 app" }]);
  });
  it("default → one midpoint frame per beat (storyboard)", () => {
    const r = pickFrames(segs, 30, {});
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ frame: 30 });
    expect(r[1]).toMatchObject({ frame: Math.round(3.65 * 30) });
  });
  it("perBeat>1 → N frames per beat, last at 0.9 of the beat (full reveal)", () => {
    const r = pickFrames(segs, 30, {}, 2);
    expect(r).toHaveLength(4);
    // beat 0 (0→2s): 0.45→0.9s, 0.9→1.8s
    expect(r[0].frame).toBe(Math.round(0.9 * 30));
    expect(r[1].frame).toBe(Math.round(1.8 * 30));
    expect(r[1].label).toContain("·full");
    // beat 1 (2.3→5s): last frame at 2.3 + 0.9*2.7 = 4.73s
    expect(r[3].frame).toBe(Math.round(4.73 * 30));
    expect(r[3].label).toContain("·full");
  });
});

describe("pickIntervalTimes", () => {
  it("spaces N frames evenly, inset from both ends", () => {
    expect(pickIntervalTimes(10, { count: 4 })).toEqual([2, 4, 6, 8]);
  });
  it("count of 1 picks the midpoint", () => {
    expect(pickIntervalTimes(10, { count: 1 })).toEqual([5]);
  });
  it("--every steps across the clip, centred", () => {
    expect(pickIntervalTimes(10, { every: 2 })).toEqual([1, 3, 5, 7, 9]);
  });
  it("count wins when both count and every are given", () => {
    expect(pickIntervalTimes(10, { count: 2, every: 1 })).toEqual([10 / 3, 20 / 3].map((n) => Math.round(n * 100) / 100));
  });
  it("returns [] when neither is set", () => {
    expect(pickIntervalTimes(10, {})).toEqual([]);
  });
});
