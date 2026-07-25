import { describe, it, expect } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";

const GL_ARGS = ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader-webgl", "--enable-unsafe-swiftshader"];

async function probe(effect: string, params: Record<string, number>): Promise<number[]> {
  const bundle = await build({
    entryPoints: ["src/render/native/page/compositor/effects/index.ts"],
    bundle: true, write: false, format: "iife", globalName: "KinoFx",
    platform: "browser", target: "chrome120", logLevel: "silent",
  });
  const browser = await puppeteer.launch({ headless: true, args: GL_ARGS });
  try {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><body><canvas id="c" width="64" height="64"></canvas></body>`);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    return await page.evaluate((effect, params) => (window as any).KinoFx.probeEffect(
      document.getElementById("c") as HTMLCanvasElement, effect, params,
    ), effect, params);
  } finally {
    await browser.close();
  }
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
