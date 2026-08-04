import { describe, expect, it } from "vitest";
import { H264_BITRATE, h264Bitrate } from "../src/render/native/page/captureH264.js";
import { FORMAT_DIMS, type FormatId } from "../src/render/formats.js";

describe("h264Bitrate", () => {
  it("leaves every 1080-class format on the flat rate", () => {
    // The clamp is the whole reason this change is safe to ship: scaling by raw pixel ratio would
    // have CUT 3:4 (1080x1440) to 37.5 Mbps, a silent quality regression on an existing format.
    for (const fmt of ["9:16", "3:4", "16:9"] as FormatId[]) {
      const { width, height } = FORMAT_DIMS[fmt];
      expect(h264Bitrate(width, height), fmt).toBe(H264_BITRATE);
    }
  });

  it("scales the 4k formats by their pixel count", () => {
    const cases: Array<[FormatId, number]> = [
      ["9:16-4k", 200_000_000], // 4x the pixels
      ["16:9-4k", 200_000_000], // 4x
      ["3:4-4k", 150_000_000], // 3x — 2160x2880 is not a full 4x
    ];
    for (const [fmt, expected] of cases) {
      const { width, height } = FORMAT_DIMS[fmt];
      expect(h264Bitrate(width, height), fmt).toBe(expected);
    }
  });

  it("keeps a 4k render at the same bits per pixel as its 1080 twin", () => {
    // The actual defect: 4K measured 0.156 bits/px against 1080's 0.765 because the budget was flat.
    const bpp = (fmt: FormatId) => {
      const { width, height } = FORMAT_DIMS[fmt];
      return h264Bitrate(width, height) / (width * height);
    };
    expect(bpp("9:16-4k")).toBeCloseTo(bpp("9:16"), 6);
    expect(bpp("16:9-4k")).toBeCloseTo(bpp("16:9"), 6);
  });

  it("does not scale a draft down", () => {
    // Drafts render onto a smaller canvas (720p-class); they must keep the flat rate, not shrink.
    expect(h264Bitrate(720, 1280)).toBe(H264_BITRATE);
    expect(h264Bitrate(1, 1)).toBe(H264_BITRATE);
  });
});
