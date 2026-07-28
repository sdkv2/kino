import { describe, it, expect, afterAll } from "vitest";
import { glProbe, closeGlHost } from "./helpers/glHost.js";
import { shapeDistance, type ShapeMask } from "../src/render/shapes.js";

afterAll(closeGlHost);

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
    // Encode the GPU's distance into the red channel over a known range so it reads back.
    const gpu = await glProbe<[typeof SAMPLES], number[]>({
      entry: "src/render/native/page/compositor/masks.ts",
      globalName: "KinoMasks",
      html: `<!doctype html><body><canvas id="c" width="512" height="512"></canvas></body>`,
      fn: (samples) =>
        (window as any).KinoMasks.probeShapeDistance(
          document.getElementById("c") as HTMLCanvasElement,
          samples,
        ),
      args: [SAMPLES],
    });

    SAMPLES.forEach(([shape, px, py], i) => {
      expect(Math.abs(gpu[i] - shapeDistance(shape, px, py))).toBeLessThan(1);
    });
  }, 120000);
});
