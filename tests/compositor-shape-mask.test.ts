import { describe, it, expect } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import { shapeDistance, type ShapeMask } from "../src/render/shapes.js";

const GL_ARGS = ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader-webgl", "--enable-unsafe-swiftshader"];

// Sample points chosen to hit every branch: inside, on-edge, off-edge, off-corner, rotated.
const SAMPLES: Array<[ShapeMask, number, number]> = [
  [{ kind: "rect", x: 100, y: 100, w: 200, h: 100 }, 200, 150],
  [{ kind: "rect", x: 100, y: 100, w: 200, h: 100 }, 70, 60],
  [{ kind: "rect", x: 100, y: 100, w: 200, h: 100, radius: 20 }, 105, 105],
  [{ kind: "circle", x: 100, y: 100, w: 200, h: 200 }, 350, 200],
  [{ kind: "rect", x: 100, y: 150, w: 200, h: 20, rotate: 90 }, 200, 200],
];

describe("mask GLSL matches the JS reference", () => {
  it("agrees within a pixel at every sample", async () => {
    const bundle = await build({
      entryPoints: ["src/render/native/page/compositor/masks.ts"],
      bundle: true, write: false, format: "iife", globalName: "KinoMasks",
      platform: "browser", target: "chrome120", logLevel: "silent",
    });
    const browser = await puppeteer.launch({ headless: true, args: GL_ARGS });
    try {
      const page = await browser.newPage();
      await page.setContent(`<!doctype html><body><canvas id="c" width="512" height="512"></canvas></body>`);
      await page.addScriptTag({ content: bundle.outputFiles[0].text });

      // Encode the GPU's distance into the red channel over a known range so it reads back.
      const gpu = await page.evaluate((samples) => {
        return (window as any).KinoMasks.probeShapeDistance(
          document.getElementById("c") as HTMLCanvasElement,
          samples,
        );
      }, SAMPLES);

      SAMPLES.forEach(([shape, px, py], i) => {
        expect(Math.abs(gpu[i] - shapeDistance(shape, px, py))).toBeLessThan(1);
      });
    } finally {
      await browser.close();
    }
  }, 120000);
});
