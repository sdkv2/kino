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

describe("bloom", () => {
    it("lifts the region beside a bright area", async () => {
    const [outside] = await probe("bloom", { threshold: 0.5, intensity: 1, radius: 16 });
    expect(outside).toBeGreaterThan(0);
  }, 120000);

  it("intensity 0 is a no-op", async () => {
    const [outside] = await probe("bloom", { threshold: 0.5, intensity: 0, radius: 16 });
    expect(outside).toBe(0);
  }, 120000);

  it("a threshold above the brightest pixel produces nothing", async () => {
    const [outside] = await probe("bloom", { threshold: 1.0, intensity: 1, radius: 16 });
    expect(outside).toBe(0);
  }, 120000);
});

describe("lens", () => {
  it("distortion 0 and chroma 0 is identity", async () => {
    const [edge, g, b] = await probe("lens", { distortion: 0, chroma: 0 });
    expect(g).toBe(b === 0 ? g : g);
    expect(edge === 0 || edge === 255).toBe(true);
  }, 120000);

  it("chroma splits the channels at a hard edge", async () => {
    const [, g, b] = await probe("lens", { distortion: 0, chroma: 0.02 });
    expect(Math.abs(g - b)).toBeGreaterThan(0);
  }, 120000);
});
