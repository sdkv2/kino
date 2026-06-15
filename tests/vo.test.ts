import { describe, it, expect } from "vitest";
import { computeTimings } from "../src/vo/vo.js";

describe("computeTimings", () => {
  it("accumulates start/end offsets with a fixed gap", () => {
    const t = computeTimings([2.0, 3.0, 1.0], 0.32);
    expect(t[0]).toMatchObject({ index: 0, startSec: 0, endSec: 2.0 });
    expect(t[1]).toMatchObject({ index: 1, startSec: 2.32, endSec: 5.32 });
    expect(t[2]).toMatchObject({ index: 2, startSec: 5.64, endSec: 6.64 });
  });
});
