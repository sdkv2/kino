import { describe, expect, it } from "vitest";
import { seamDiff } from "../src/media/seam.js";

describe("seamDiff", () => {
  it("returns 0 for identical buffers", () => {
    const a = Buffer.from([10, 20, 30, 40, 50, 60]);
    expect(seamDiff(a, Buffer.from(a))).toBe(0);
  });

  it("returns mean abs channel diff", () => {
    const a = Buffer.from([0, 0, 0, 0]);
    const b = Buffer.from([10, 0, 20, 0]);
    // (10+0+20+0)/4 = 7.5
    expect(seamDiff(a, b)).toBe(7.5);
  });

  it("throws on length mismatch", () => {
    expect(() => seamDiff(Buffer.from([1]), Buffer.from([1, 2]))).toThrow(/length mismatch/);
  });
});
