import { describe, it, expect } from "vitest";
import { inspectPlan, parseTimes, pickFrames, pickIntervalTimes, timesAround } from "../src/render/preview.js";
import type { KinoProps } from "../src/render/props.js";
import { GAP } from "../src/vo/gap.js";
import { computeTimings } from "../src/vo/vo.js";

const props = {
  fps: 30,
  avatar: null,
  background: { kind: "mesh", image: null, customCode: null, colors: [], intensity: 0.5 },
  segments: [
    { kind: "scene", caption: "hi", startSec: 0, endSec: 2 },
    { kind: "video", source: "x.png", caption: "a", startSec: 2.3, endSec: 5, kicker: { text: "86%", color: "#1", fg: "#0" }, captionMode: "words" },
  ],
} as unknown as KinoProps;

describe("inspectPlan", () => {
  it("summarises the resolved render plan", () => {
    const p = inspectPlan(props);
    expect(p).toMatchObject({ fps: 30, presenter: false, background: "mesh" });
    expect(p.durationSec).toBeCloseTo(5);
    expect(p.segments[0]).toMatchObject({ index: 0, kind: "scene", startSec: 0, endSec: 2, durSec: 2, captionMode: "phrase", hasKicker: false });
    expect(p.segments[1]).toMatchObject({ index: 1, kind: "video", source: "x.png", captionMode: "words", hasKicker: true });
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
    { kind: "scene", startSec: 0, endSec: 2 },
    { kind: "video", startSec: 2.3, endSec: 5 },
  ];
  it("at-list → one frame per timestamp", () => {
    expect(pickFrames(segs, 30, { at: [1, 4] })).toEqual([
      { frame: 30, label: "1s" },
      { frame: 120, label: "4s" },
    ]);
  });
  it("segment → the midpoint frame of that segment", () => {
    expect(pickFrames(segs, 30, { segment: 1 })).toEqual([{ frame: Math.round(3.65 * 30), label: "1 video" }]);
  });
  it("out-of-range segment → clear error, not undefined deref", () => {
    expect(() => pickFrames(segs, 30, { segment: 2 })).toThrow(/--segment 2 out of range .*2 segments.*0\.\.1/);
  });
  // A run wipes the stills dir (so nothing stale is ever read by path), which made the natural
  // "check each beat" loop — one `kino still --segment N` per beat — delete all but the last.
  // Taking a list lets that be one run.
  it("segment list → one midpoint frame per requested beat, in the given order", () => {
    expect(pickFrames(segs, 30, { segment: [1, 0] })).toEqual([
      { frame: Math.round(3.65 * 30), label: "1 video" },
      { frame: 30, label: "0 scene" },
    ]);
  });
  it("a one-element list behaves exactly like the scalar form", () => {
    expect(pickFrames(segs, 30, { segment: [1] })).toEqual(pickFrames(segs, 30, { segment: 1 }));
  });
  it("reports the offending index when any member of the list is out of range", () => {
    expect(() => pickFrames(segs, 30, { segment: [0, 7] })).toThrow(/--segment 7 out of range/);
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

describe("timesAround", () => {
  it("defaults to 5 samples across a 1s window centered on the point", () => {
    expect(timesAround(2)).toEqual([1.5, 1.75, 2, 2.25, 2.5]);
  });
  it("count 1 returns just the center", () => {
    expect(timesAround(3.2, { count: 1 })).toEqual([3.2]);
  });
  it("respects span and count", () => {
    expect(timesAround(5, { count: 3, span: 2 })).toEqual([4, 5, 6]);
  });
  it("clamps to [min, max]", () => {
    expect(timesAround(0.2, { count: 3, span: 1, min: 0, max: 10 })).toEqual([0, 0.2, 0.7]);
  });
});

describe("inspectPlan interBeatGapSec", () => {
  // A beat's rendered length is its authored dur PLUS this gap (visuals hold to the next beat's
  // start so nothing blinks off during the silence), so reporting the gap is what makes the
  // per-beat durSec numbers add up instead of looking like an off-by-0.32 bug.
  it("reports the inter-beat gap so durSec arithmetic is checkable", () => {
    expect(inspectPlan(props).interBeatGapSec).toBe(GAP);
  });

  // On the AUDIO timeline the gap is silence between clips: a beat owns exactly its own duration
  // and the next one starts GAP later. The visual hold (build.ts) is what stretches the rendered
  // beat to dur + GAP; both readings come from this one constant.
  it("separates consecutive beats on the audio timeline by exactly the gap", () => {
    const t = computeTimings([3.4, 3.6], GAP);
    expect(t[0]).toMatchObject({ startSec: 0, endSec: 3.4, durSec: 3.4 });
    expect(t[1].startSec).toBeCloseTo(3.4 + GAP, 5);
  });
});
