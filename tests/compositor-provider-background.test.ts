import { describe, it, expect, afterAll } from "vitest";
import { glProbe, closeGlHost } from "./helpers/glHost.js";

afterAll(closeGlHost);

describe("canvas2d background source", () => {
  it("paints the night colour before running the preset draw", async () => {
    const px = await glProbe<[], number[]>({
      entry: "src/render/native/page/compositor/providers/canvas2d.ts",
      globalName: "KinoBg",
      html: "<!doctype html><body></body>",
      fn: async () => {
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
      },
    });
    expect(px).toEqual([0x0b, 0x10, 0x20]);
  }, 120000);
});
