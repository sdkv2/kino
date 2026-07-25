import { describe, it, expect } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";

const GL_ARGS = ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader-webgl", "--enable-unsafe-swiftshader"];

describe("runChain", () => {
  it("applies passes in order — two halvings quarter the value", async () => {
    const bundle = await build({
      entryPoints: ["src/render/native/page/compositor/effects/chain.ts"],
      bundle: true, write: false, format: "iife", globalName: "KinoChain",
      platform: "browser", target: "chrome120", logLevel: "silent",
    });
    const browser = await puppeteer.launch({ headless: true, args: GL_ARGS });
    try {
      const page = await browser.newPage();
      await page.setContent(`<!doctype html><body><canvas id="c" width="16" height="16"></canvas></body>`);
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const value = await page.evaluate(() => (window as any).KinoChain.probeChain(
        document.getElementById("c") as HTMLCanvasElement,
        ["halve", "halve"],
      ));
      // 1.0 → 0.5 → 0.25, read back as 8-bit.
      expect(value).toBeGreaterThanOrEqual(62);
      expect(value).toBeLessThanOrEqual(66);
    } finally {
      await browser.close();
    }
  }, 120000);

  it("returns the source unchanged for an empty chain", async () => {
    const bundle = await build({
      entryPoints: ["src/render/native/page/compositor/effects/chain.ts"],
      bundle: true, write: false, format: "iife", globalName: "KinoChain",
      platform: "browser", target: "chrome120", logLevel: "silent",
    });
    const browser = await puppeteer.launch({ headless: true, args: GL_ARGS });
    try {
      const page = await browser.newPage();
      await page.setContent(`<!doctype html><body><canvas id="c" width="16" height="16"></canvas></body>`);
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const value = await page.evaluate(() => (window as any).KinoChain.probeChain(
        document.getElementById("c") as HTMLCanvasElement, [],
      ));
      expect(value).toBe(255);
    } finally {
      await browser.close();
    }
  }, 120000);
});
