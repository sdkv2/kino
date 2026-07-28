import { describe, it, expect, afterAll } from "vitest";
import { glProbe, closeGlHost } from "./helpers/glHost.js";

afterAll(closeGlHost);

const ENTRY = "src/render/native/page/compositor/renderer.ts";
const GLOBAL = "KinoRenderer";
const HTML = `<!doctype html><body style="margin:0"><canvas id="c" width="200" height="200"></canvas></body>`;

describe("StageRenderer", () => {
  it("composites two solid layers in order, with alpha, in linear light", async () => {
    const px = await glProbe<[], number[]>({
      entry: ENTRY,
      globalName: GLOBAL,
      html: HTML,
      fn: () => {
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
                gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
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
        // draw() takes normalized layers; textGamma is required on LayerDraw, and omitting it
        // sends NaN to the uniform, which poisons pow() and blows the frame to white.
        const layer = (id: string, opacity: number) => ({
          id, source: { providerId: id }, rect: { x: 0, y: 0, w: 200, h: 200 },
          transform: { scale: 1, rotate: 0, translate: [0, 0] }, opacity, blend: "normal", effects: [], textGamma: 1,
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
      },
    });

    // White at 50% over black, blended in LINEAR light, is ~188. sRGB blending gives 128.
    expect(px[0]).toBeGreaterThanOrEqual(185);
    expect(px[0]).toBeLessThanOrEqual(191);
  }, 120000);

  it("decodes uploaded sRGB textures — mid-grey over black tracks the linear curve", async () => {
    const px = await glProbe<[], number[]>({
      entry: ENTRY,
      globalName: GLOBAL,
      html: HTML,
      fn: () => {
        const solid = (color: string) => {
          const c = document.createElement("canvas");
          c.width = 200; c.height = 200;
          const ctx = c.getContext("2d")!;
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, 200, 200);
          return c;
        };
        // Matches uploadCanvasOrImage: straight alpha, SRGB8_ALPHA8.
        const src = (canvas: HTMLCanvasElement) => {
          let tex: WebGLTexture | null = null;
          return {
            prepare: async () => {},
            size: () => ({ w: 200, h: 200 }),
            texture: (gl: WebGL2RenderingContext) => {
              if (!tex) {
                tex = gl.createTexture();
                gl.bindTexture(gl.TEXTURE_2D, tex);
                gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
              }
              return tex;
            },
          };
        };
        const theme = { font: "Arial", night: "#000", mint: "#0f0", green: "#0f0", gold: "#fc0", white: "#fff", captionFontSize: 74, captionStroke: 9, film: 0 };
        const canvas = document.getElementById("c") as HTMLCanvasElement;
        const r = new (window as any).KinoRenderer.StageRenderer(canvas, { width: 200, height: 200, ss: 1 });
        const sources = new Map<string, any>([
          ["a", src(solid("#000000"))],
          ["b", src(solid("#808080"))],
        ]);
        // draw() takes normalized layers; textGamma is required on LayerDraw, and omitting it
        // sends NaN to the uniform, which poisons pow() and blows the frame to white.
        const layer = (id: string, opacity: number) => ({
          id, source: { providerId: id }, rect: { x: 0, y: 0, w: 200, h: 200 },
          transform: { scale: 1, rotate: 0, translate: [0, 0] }, opacity, blend: "normal", effects: [], textGamma: 1,
        });
        const props = { theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null, background: { kind: "custom", image: null, shaderCode: null, customCode: "", params: {}, keyframes: [], triggers: [] }, disclosure: "", segments: [{ kind: "scene", caption: "", startSec: 0, endSec: 2 }] };
        const read = document.createElement("canvas");
        read.width = 200; read.height = 200;
        const rctx = read.getContext("2d")!;

        // Several alphas, not just 0.5 — a single sample can be matched by a wrong-but-close
        // transfer function, three points on the curve cannot.
        return [0.25, 0.5, 0.75].map((o) => {
          r.draw([layer("a", 1), layer("b", o)], sources, 0, { theme, props });
          rctx.clearRect(0, 0, 200, 200);
          rctx.drawImage(canvas, 0, 0);
          return rctx.getImageData(100, 100, 1, 1).data[0];
        });
      },
    });

    // sRGB 128 decodes to linear 0.2159. Scale by opacity over black, re-encode:
    //   0.25 -> 0.0540 -> 66     0.5 -> 0.1080 -> 92     0.75 -> 0.1619 -> 112
    // Skipping the decode, or blending in sRGB, gives 32 / 64 / 96 instead.
    expect(px[0]).toBeGreaterThanOrEqual(63);
    expect(px[0]).toBeLessThanOrEqual(69);
    expect(px[1]).toBeGreaterThanOrEqual(89);
    expect(px[1]).toBeLessThanOrEqual(95);
    expect(px[2]).toBeGreaterThanOrEqual(109);
    expect(px[2]).toBeLessThanOrEqual(115);
  }, 180000);

  it("textGamma lifts partial coverage — alpha 0.5 at gamma 2 reads brighter", async () => {
    const px = await glProbe<[], number[]>({
      entry: ENTRY,
      globalName: GLOBAL,
      html: HTML,
      fn: () => {
        const fill = (style: string) => {
          const c = document.createElement("canvas");
          c.width = 200; c.height = 200;
          const ctx = c.getContext("2d")!;
          ctx.fillStyle = style;
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
                gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
              }
              return tex;
            },
          };
        };
        const theme = { font: "Arial", night: "#000", mint: "#0f0", green: "#0f0", gold: "#fc0", white: "#fff", captionFontSize: 74, captionStroke: 9, film: 0 };
        const canvas = document.getElementById("c") as HTMLCanvasElement;
        const r = new (window as any).KinoRenderer.StageRenderer(canvas, { width: 200, height: 200, ss: 1 });
        // Partial alpha in the SOURCE — textGamma acts on the texture's alpha channel, so an
        // opaque layer would prove nothing no matter what the uniform is set to.
        const sources = new Map<string, any>([
          ["a", src(fill("#000000"))],
          ["b", src(fill("rgba(255,255,255,0.5)"))],
        ]);
        const layer = (id: string, textGamma: number) => ({
          id, source: { providerId: id }, rect: { x: 0, y: 0, w: 200, h: 200 },
          transform: { scale: 1, rotate: 0, translate: [0, 0] }, opacity: 1, blend: "normal", effects: [], textGamma,
        });
        const props = { theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null, background: { kind: "custom", image: null, shaderCode: null, customCode: "", params: {}, keyframes: [], triggers: [] }, disclosure: "", segments: [{ kind: "scene", caption: "", startSec: 0, endSec: 2 }] };
        const read = document.createElement("canvas");
        read.width = 200; read.height = 200;
        const rctx = read.getContext("2d")!;

        return [1, 2].map((g) => {
          r.draw([layer("a", 1), layer("b", g)], sources, 0, { theme, props });
          rctx.clearRect(0, 0, 200, 200);
          rctx.drawImage(canvas, 0, 0);
          return rctx.getImageData(100, 100, 1, 1).data[0];
        });
      },
    });

    // White at source alpha 0.5 over black, in linear light, encodes to ~188.
    // textGamma 2 lifts coverage to pow(0.5, 1/2) = 0.707, which encodes to ~219.
    expect(px[0]).toBeGreaterThanOrEqual(185);
    expect(px[0]).toBeLessThanOrEqual(191);
    expect(px[1]).toBeGreaterThanOrEqual(216);
    expect(px[1]).toBeLessThanOrEqual(222);
  }, 180000);
});
