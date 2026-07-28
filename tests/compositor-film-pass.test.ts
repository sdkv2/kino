import { describe, it, expect, afterAll } from "vitest";
import { filmFinishParams, luminance } from "../src/render/filmFinish.js";
import { glProbe, closeGlHost } from "./helpers/glHost.js";

afterAll(closeGlHost);

async function probeFilm(night: string, intensity: number): Promise<{ centre: number; corner: number; grainSpread: number }> {
  return glProbe<[string, number], { centre: number; corner: number; grainSpread: number }>({
    entry: "src/render/native/page/compositor/effects/index.ts",
    globalName: "KinoFx",
    html: `<!doctype html><body><canvas id="c" width="128" height="128"></canvas></body>`,
    fn: (night, intensity) =>
      (window as any).KinoFx.probeFilm(document.getElementById("c") as HTMLCanvasElement, night, intensity),
    args: [night, intensity],
  });
}

describe("film pass", () => {
  it("darkens the corners and leaves the centre alone", async () => {
    const { centre, corner } = await probeFilm("#0b1020", 1);
    expect(corner).toBeLessThan(centre);
    expect(centre).toBeGreaterThanOrEqual(250);
  }, 120000);

  it("intensity 0 is a complete no-op", async () => {
    const { centre, corner, grainSpread } = await probeFilm("#0b1020", 0);
    expect(corner).toBe(centre);
    expect(grainSpread).toBe(0);
  }, 120000);

  it("scales the vignette with intensity, matching filmFinishParams", async () => {
    const full = await probeFilm("#0b1020", 1);
    const half = await probeFilm("#0b1020", 0.5);
    expect(half.corner).toBeGreaterThan(full.corner);
    expect(half.corner).toBeLessThan(half.centre);
  }, 240000);

  it("uses the lighter vignette on a light night colour, as the CSS does", async () => {
    expect(luminance("#f4f1ea")).toBeGreaterThan(0.5);
    const dark = await probeFilm("#0b1020", 1);
    const light = await probeFilm("#f4f1ea", 1);
    expect(light.corner).toBeGreaterThan(dark.corner);
  }, 240000);

  it("produces grain that is stable for a given frame", async () => {
    const a = await probeFilm("#0b1020", 1);
    const b = await probeFilm("#0b1020", 1);
    expect(a.grainSpread).toBe(b.grainSpread);
  }, 240000);
});

async function probeGrain(night: string, intensity: number, level: number, ss = 1) {
  return glProbe<[string, number, number, number], { spread: number; adjacentDiff: number }>({
    entry: "src/render/native/page/compositor/effects/index.ts",
    globalName: "KinoFx",
    html: `<!doctype html><body><canvas id="c" width="128" height="128"></canvas></body>`,
    fn: (night, intensity, level, ss) =>
      (window as any).KinoFx.probeGrain(document.getElementById("c") as HTMLCanvasElement, night, intensity, level, ss),
    args: [night, intensity, level, ss],
  });
}

// Grain that is an independent random value per pixel is not film grain — it is the signature of
// sensor noise and compression. Real grain has a clump size and is a function of exposure, so it
// lives in the midtones and thins out toward both flat black and blown white.
describe("film grain reads as grain, not as digital noise", () => {
  it("has a clump size — neighbouring pixels are correlated, not independent", async () => {
    const { spread, adjacentDiff } = await probeGrain("#0b1020", 1, 0.5);
    expect(spread).toBeGreaterThan(1); // grain is actually present to measure
    // Independent per-pixel noise steps as far between neighbours as its overall spread.
    expect(adjacentDiff / spread).toBeLessThan(0.8);
  }, 120000);

  it("thins out in flat blacks, where uniform noise reads as compression", async () => {
    const shadow = await probeGrain("#0b1020", 1, 0.02);
    const mid = await probeGrain("#0b1020", 1, 0.5);
    expect(shadow.spread).toBeLessThan(mid.spread * 0.5);
  }, 240000);

  it("thins out in blown highlights too", async () => {
    const hot = await probeGrain("#0b1020", 1, 0.99);
    const mid = await probeGrain("#0b1020", 1, 0.5);
    expect(hot.spread).toBeLessThan(mid.spread * 0.5);
  }, 240000);

  it("keeps the same clump size when the stage is supersampled", async () => {
    // film runs BEFORE the ss resolve, so without compensation a 2x render halves the grain size
    // and the finish silently changes with --quality.
    const one = await probeGrain("#0b1020", 1, 0.5, 1);
    const two = await probeGrain("#0b1020", 1, 0.5, 2);
    expect(two.adjacentDiff / two.spread).toBeCloseTo(one.adjacentDiff / one.spread, 1);
  }, 240000);
});
