import { describe, it, expect } from "vitest";
import { probeFramePicks, isUnderAnimated, PROBE_POINTS } from "../src/render/motionProbe.js";

describe("probeFramePicks", () => {
  const segs = [
    { kind: "app", startSec: 0, endSec: 2 },
    { kind: "motion", startSec: 2, endSec: 5, motion: {} },
    { kind: "motion", startSec: 5, endSec: 6, motion: {} },
  ] as never[];
  it("samples each full-screen motion beat at the probe points", () => {
    const picks = probeFramePicks(segs as never, 30);
    expect(picks).toEqual([
      { segment: 1, frames: PROBE_POINTS.map((p) => Math.round((2 + p * 3) * 30)) },
      { segment: 2, frames: PROBE_POINTS.map((p) => Math.round((5 + p * 1) * 30)) },
    ]);
  });
  it("skips beats without a full-screen motion graphic", () => {
    expect(probeFramePicks([{ kind: "app", startSec: 0, endSec: 2 }] as never, 30)).toEqual([]);
  });
});

describe("isUnderAnimated", () => {
  it("flags a beat whose probe frames barely differ", () => {
    expect(isUnderAnimated([0.05, 0.1])).toBe(true);
  });
  it("passes a beat with visible change between any probe pair", () => {
    expect(isUnderAnimated([0.05, 4])).toBe(false);
  });
  it("treats an empty diff list as fine (nothing to judge)", () => {
    expect(isUnderAnimated([])).toBe(false);
  });
});
