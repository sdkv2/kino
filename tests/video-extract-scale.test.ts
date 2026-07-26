import { describe, it, expect } from "vitest";
import { extractMaxDim, scaleFilter } from "../src/render/native/videoFrames.js";

// Dense extraction wrote source-resolution JPEGs regardless of output size, so 4K footage was
// decoded, re-encoded and texture-uploaded at 3840x2160 into a 1080-wide composition. Measured
// cost of the waste: 1.86x on Linux, 1.47x on macOS. The budget has to account for two things
// the naive "just scale to 1080" would break — push-in crops into the frame (peak shot scale
// 1.2), and the whole compositor canvas is supersampled (renderer.ts: width = outW * ss).
describe("extractMaxDim", () => {
  it("keeps enough pixels for the deepest push-in at draft quality", () => {
    expect(extractMaxDim(1920, 1)).toBe(2304); // 1920 * 1.2
  });

  it("scales the budget with supersampling so SS=2 keeps 4K detail", () => {
    expect(extractMaxDim(1920, 2)).toBe(4608);
  });
});

describe("scaleFilter", () => {
  it("fits inside the budget, preserves aspect, and never upscales", () => {
    const f = scaleFilter(2304);
    expect(f).toContain("min(iw,2304)");
    expect(f).toContain("min(ih,2304)");
    expect(f).toContain("force_original_aspect_ratio=decrease");
  });

  it("keeps dimensions even so yuv420p encoding stays legal", () => {
    expect(scaleFilter(2304)).toContain("force_divisible_by=2");
  });
});
