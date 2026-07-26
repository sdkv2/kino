import { describe, it, expect } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";

async function inPage<T>(fn: (js: string) => Promise<T>): Promise<T> {
  const bundle = await build({
    entryPoints: ["src/render/native/page/compositor/renderer.ts"],
    bundle: true, write: false, format: "iife", globalName: "KinoRenderer",
    platform: "browser", target: "chrome120", logLevel: "silent",
  });
  return fn(bundle.outputFiles[0].text);
}

describe("StageRenderer", () => {
  it("composites two solid layers in order, with alpha, in sRGB", async () => {
    const js = await inPage(async (js) => js);
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader-webgl", "--enable-unsafe-swiftshader"],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 200, height: 200 });
      await page.setContent(`<!doctype html><body style="margin:0"><canvas id="c" width="200" height="200"></canvas></body>`);
      await page.addScriptTag({ content: js });

      const px = await page.evaluate(() => {
        const solid = (color: string) => {
          const c = document.createElement("canvas");
          c.width = 200; c.height = 200;
          const ctx = c.getContext("2d")!;
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, 200, 200);
          return c;
        };
        const src = (canvas: HTMLCanvasElement) => {
          let tex: WebGLTexture | null = null;
          return {
            prepare: async () => {},
            size: () => ({ w: 200, h: 200 }),
            texture: (gl: WebGL2RenderingContext) => {
              if (!tex) {
                tex = gl.createTexture();
                gl.bindTexture(gl.TEXTURE_2D, tex);
                gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
              }
              return tex;
            },
          };
        };
        const canvas = document.getElementById("c") as HTMLCanvasElement;
        const r = new (window as any).KinoRenderer.StageRenderer(canvas, { width: 200, height: 200, ss: 1 });
        const sources = new Map<string, any>([
          ["a", src(solid("#000000"))],
          ["b", src(solid("#ffffff"))],
        ]);
        const layer = (id: string, opacity: number) => ({
          id, source: { providerId: id }, rect: { x: 0, y: 0, w: 200, h: 200 },
          transform: { scale: 1, rotate: 0, translate: [0, 0] }, opacity, blend: "normal", effects: [],
        });
        r.draw([layer("a", 1), layer("b", 0.5)], sources, 0, {
          theme: { font: "Arial", night: "#000", mint: "#0f0", green: "#0f0", gold: "#fc0", white: "#fff", captionFontSize: 74, captionStroke: 9, film: 0 },
          props: { theme: { font: "Arial", night: "#000", mint: "#0f0", green: "#0f0", gold: "#fc0", white: "#fff", captionFontSize: 74, captionStroke: 9, film: 0 }, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null, background: { kind: "custom", image: null, shaderCode: null, customCode: "", params: {}, keyframes: [], triggers: [] }, disclosure: "", segments: [{ kind: "scene", caption: "", startSec: 0, endSec: 2 }] },
        });

        const read = document.createElement("canvas");
        read.width = 200; read.height = 200;
        read.getContext("2d")!.drawImage(canvas, 0, 0);
        const d = read.getContext("2d")!.getImageData(100, 100, 1, 1).data;
        return [d[0], d[1], d[2]];
      });

      // White at 50% over black, blended in sRGB, is 128 — not 188 (which is what
      // linear-space blending would produce).
      expect(px[0]).toBeGreaterThanOrEqual(126);
      expect(px[0]).toBeLessThanOrEqual(130);
    } finally {
      await browser.close();
    }
  }, 120000);
});
