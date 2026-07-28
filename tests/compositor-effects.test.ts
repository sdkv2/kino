import { describe, it, expect, afterAll } from "vitest";
import { glProbe, closeGlHost } from "./helpers/glHost.js";

afterAll(closeGlHost);

async function probe(effect: string, params: Record<string, number>): Promise<number[]> {
  return glProbe<[string, Record<string, number>], number[]>({
    entry: "src/render/native/page/compositor/effects/index.ts",
    globalName: "KinoFx",
    html: `<!doctype html><body><canvas id="c" width="64" height="64"></canvas></body>`,
    fn: (effect, params) =>
      (window as any).KinoFx.probeEffect(document.getElementById("c") as HTMLCanvasElement, effect, params),
    args: [effect, params],
  });
}

describe("blur", () => {
  it("spreads a hard edge — the pixel beside the edge gains value", async () => {
    const [atEdge] = await probe("blur", { radius: 8 });
    expect(atEdge).toBeGreaterThan(10);
    expect(atEdge).toBeLessThan(245);
  }, 300000);

  it("radius 0 leaves the edge hard", async () => {
    const [atEdge] = await probe("blur", { radius: 0 });
    expect(atEdge === 0 || atEdge === 255).toBe(true);
  }, 300000);
});

describe("grade", () => {
  it("saturation 0 makes a colored pixel grey", async () => {
    const [, g, b] = await probe("grade", { saturation: 0, brightness: 1, contrast: 1 });
    expect(Math.abs(g - b)).toBeLessThanOrEqual(2);
  }, 300000);

  it("brightness scales value", async () => {
    const [, full] = await probe("grade", { saturation: 1, brightness: 1, contrast: 1 });
    const [, half] = await probe("grade", { saturation: 1, brightness: 0.5, contrast: 1 });
    expect(half).toBeLessThan(full);
  }, 300000);

  it("does not darken the edge of a soft shape — premultiply handled correctly", async () => {
    // A grade on premultiplied values without un-premultiplying produces a dark rim.
    const [, , , edgeDelta] = await probe("grade", { saturation: 1, brightness: 1.2, contrast: 1 });
    expect(edgeDelta).toBeLessThan(6);
  }, 300000);
});

describe("glow", () => {
  it("adds light around a bright region", async () => {
    const [outside] = await probe("glow", { radius: 12, intensity: 1, threshold: 0.5 });
    expect(outside).toBeGreaterThan(0);
  }, 300000);

  it("intensity 0 is a no-op", async () => {
    const [outside] = await probe("glow", { radius: 12, intensity: 0, threshold: 0.5 });
    expect(outside).toBe(0);
  }, 300000);
});
