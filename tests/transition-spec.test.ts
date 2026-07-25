import { describe, it, expect } from "vitest";
import { transitionProgress } from "../src/render/transitionSpec.js";

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
