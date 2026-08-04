// The output-dither pixel test (GPU scope). The defect this fixes: the compositor rasterises at
// 8 bits per channel, so a near-black ramp quantizes to visible plateaus (measured 30–48px runs).
// An ordered Bayer dither must spread those plateaus into a run of distinct neighbouring levels.
//
// The probe renders the same near-black ramp twice — dither off and on — and counts distinct
// 8-bit values along one row. The assertion is on the DELTA: dither-on must produce strictly more
// distinct levels than dither-off on the SAME ramp, at full strength, and strength 0 must be a
// byte-identical no-op (the determinism contract — a dither that moved pixels at strength 0 would
// also move them between identical frames).
import { describe, it, expect, afterAll } from "vitest";
import { glProbe, closeGlHost } from "./helpers/glHost.js";

afterAll(closeGlHost);

async function probeDistinct(strength: number): Promise<{ off: number; on: number }> {
  return glProbe<[number], { off: number; on: number }>({
    entry: "src/render/native/page/compositor/effects/index.ts",
    globalName: "KinoFx",
    html: `<!doctype html><body><canvas id="c" width="256" height="256"></canvas></body>`,
    fn: (strength) =>
      (window as any).KinoFx.probeDitherDistinctLevels(
        document.getElementById("c") as HTMLCanvasElement,
        strength,
      ),
    args: [strength],
  });
}

describe("output dither", () => {
  it("spreads the ramp's plateaus into more distinct levels at full strength", async () => {
    const { off, on } = await probeDistinct(1);
    // The raw ramp alone has some levels (the gradient's own dithering at the canvas), but a
    // full-strength Bayer dither must strictly increase the level count on the same row.
    expect(on).toBeGreaterThan(off);
  }, 300000);

  it("is a byte-identical no-op at strength 0 — the determinism contract", async () => {
    const { off, on } = await probeDistinct(0);
    expect(on).toBe(off);
  }, 300000);

  it("at the default half-strength still de-bands the ramp", async () => {
    const { off, on } = await probeDistinct(0.5);
    expect(on).toBeGreaterThan(off);
  }, 300000);
});
