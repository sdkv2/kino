// `layersAt` is pure and cannot decode an image, so the logo's natural aspect has to be measured
// node-side at build and threaded through props. Anything unprobeable falls back to 1 — a square
// rect is wrong-but-bounded, where the old full-frame rect was catastrophically wrong.
import { describe, it, expect } from "vitest";
import { probeImageAspect } from "../src/media/ffmpeg.js";

describe("probeImageAspect", () => {
  it("reports width/height for a real image", async () => {
    // logo/kino-logo-web.png is 1120x405.
    expect(await probeImageAspect("logo/kino-logo-web.png")).toBeCloseTo(1120 / 405, 4);
  });

  it("falls back to square when the file cannot be probed", async () => {
    expect(await probeImageAspect("logo/does-not-exist.png")).toBe(1);
  });
});
