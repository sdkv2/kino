import { describe, it, expect } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";

describe("canvas2d background source", () => {
  it("paints the night colour before running the preset draw", async () => {
    const bundle = await build({
      entryPoints: ["src/render/native/page/compositor/providers/canvas2d.ts"],
      bundle: true, write: false, format: "iife", globalName: "KinoBg",
      platform: "browser", target: "chrome120", logLevel: "silent",
    });
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader-webgl", "--enable-unsafe-swiftshader"],
    });
    try {
      const page = await browser.newPage();
      await page.setContent("<!doctype html><body></body>");
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const px = await page.evaluate(async () => {
        // A draw that paints nothing: whatever is left is the night fill.
        const src = (window as any).KinoBg.createCanvas2dSource({
          draw: () => {},
          params: {}, keyframes: [], triggers: [],
          theme: { night: "#0b1020" },
          width: 64, height: 64, fps: 30,
        });
        await src.prepare(0);
        const c = src.canvasForTest();
        const d = c.getContext("2d").getImageData(32, 32, 1, 1).data;
        return [d[0], d[1], d[2]];
      });
      expect(px).toEqual([0x0b, 0x10, 0x20]);
    } finally {
      await browser.close();
    }
  }, 120000);
});
