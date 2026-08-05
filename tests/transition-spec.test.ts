import { describe, it, expect } from "vitest";
import { transitionProgress, transitionKindForWindow, groupSpans } from "../src/render/transitionSpec.js";
import type { KinoProps } from "../src/render/props.js";

describe("transitionProgress", () => {
  const groups = [
    { id: "beat0", from: 0, to: 60 },
    { id: "beat1", from: 48, to: 120 },  // 12-frame overlap
  ];

  it("returns null outside any overlap", () => {
    expect(transitionProgress({ groups, frame: 20 })).toBeNull();
    expect(transitionProgress({ groups, frame: 90 })).toBeNull();
  });

  it("returns 0 at the first overlapping frame", () => {
    expect(transitionProgress({ groups, frame: 48 })!.p).toBeCloseTo(0, 5);
  });

  it("returns 1 at the last overlapping frame", () => {
    expect(transitionProgress({ groups, frame: 60 })!.p).toBeCloseTo(1, 5);
  });

  it("names the outgoing and incoming groups", () => {
    const t = transitionProgress({ groups, frame: 54 })!;
    expect([t.from, t.to]).toEqual(["beat0", "beat1"]);
  });

  it("is monotonic across the window", () => {
    expect(transitionProgress({ groups, frame: 56 })!.p).toBeGreaterThan(
      transitionProgress({ groups, frame: 50 })!.p,
    );
  });

  it("handles three groups by taking the overlap containing this frame", () => {
    const three = [...groups, { id: "beat2", from: 108, to: 180 }];
    expect(transitionProgress({ groups: three, frame: 114 })!.from).toBe("beat1");
  });
});

describe("transitionKindForWindow", () => {
  const props = (segs: unknown[]) => ({ fps: 30, segments: segs }) as unknown as KinoProps;
  const win = { from: "beat0", to: "beat1", p: 0.5 };

  // The bug this guards: motion beats fell through to pickTransition(0, …), which returns
  // TRANSITIONS[0] — "fly-left". Every motion→motion handoff in every spec got a punchy horizontal
  // slide, contradicting the schema comment and docs, and the hard-coded index 0 meant it wasn't
  // even auto-varying. A motion beat owns the whole frame; sliding that frame sideways reads as a
  // compositing glitch, not an authored move.
  it("defaults a motion beat to dissolve, never the app fly-in rotation", () => {
    const p = props([
      { kind: "motion", startSec: 0, endSec: 3, motion: {} },
      { kind: "motion", startSec: 3, endSec: 6, motion: {} },
    ]);
    expect(transitionKindForWindow(p, win)).toBe("dissolve");
  });

  it("honours an explicit transition on a motion beat", () => {
    const p = props([
      { kind: "motion", startSec: 0, endSec: 3, motion: {} },
      { kind: "motion", startSec: 3, endSec: 6, motion: {}, transition: "wipe-down" },
    ]);
    expect(transitionKindForWindow(p, win)).toBe("wipe-down");
  });

  it("leaves the video auto-vary rotation alone", () => {
    const p = props([
      { kind: "video", source: "a.png", startSec: 0, endSec: 3 },
      { kind: "video", source: "b.png", startSec: 3, endSec: 6 },
    ]);
    // second video still picks from the punchy still rotation (index 1 → "fly-up")
    expect(transitionKindForWindow(p, win)).toBe("fly-up");
  });
});

describe("groupSpans (video beat chaining)", () => {
  const props = (segs: unknown[]) => ({ fps: 30, segments: segs }) as unknown as KinoProps;

  // The bug this guards: consecutive video beats always got a 12-frame crossfade overlap,
  // full stop — `next.transition` was never consulted, so `transition: "cut"` on the incoming
  // beat silently did nothing for video→video pairs (it correctly zeroes the overlap for
  // motion→motion via motionXfadeFrames; video beats had no equivalent gate). Confirmed by a
  // kino dogfood session building a beat-cut music video with hard cuts as the whole premise.
  it("still crossfades consecutive video beats by default (no transition override)", () => {
    const p = props([
      { kind: "video", source: "a.mp4", startSec: 0, endSec: 2 },
      { kind: "video", source: "b.mp4", startSec: 2, endSec: 4 },
    ]);
    const spans = groupSpans(p);
    // beat0 (from 0, ends at 2s=60f) extends 12 frames past beat1's start (60) → overlap.
    expect(spans[0].to).toBe(60 + 12);
    expect(spans[1].from).toBe(60);
    expect(spans[0].to).toBeGreaterThan(spans[1].from); // real overlap window
  });

  it("produces a real hard cut (zero overlap) when the incoming video beat sets transition: cut", () => {
    const p = props([
      { kind: "video", source: "a.mp4", startSec: 0, endSec: 2 },
      { kind: "video", source: "b.mp4", startSec: 2, endSec: 4, transition: "cut" },
    ]);
    const spans = groupSpans(p);
    expect(spans[0].to).toBe(spans[1].from); // no overlap at all
    expect(transitionProgress({ groups: spans, frame: spans[1].from })).toBeNull(); // reads as a hard cut
  });
});
