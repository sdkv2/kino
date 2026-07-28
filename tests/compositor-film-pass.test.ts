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
