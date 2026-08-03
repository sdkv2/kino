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

/**
 * `halation` widens the bloom per channel, so it is only visible as a SPREAD: the assertions read
 * the blur outward from an isolated bright square and compare red against blue at distance.
 *
 * The blur (x then y) is probed on its own rather than the whole three-pass chain, because the
 * composite step only adds the halo back onto the original — reading the halo directly is what
 * makes "red reaches further than blue" a measurement instead of an inference.
 */
function bloomSpread(params: Record<string, number>, offsets: number[]): Promise<number[][]> {
  return glProbe<[Record<string, number>, number[]], number[][]>({
    entry: "src/render/native/page/compositor/effects/index.ts",
    globalName: "KinoFx",
    html: `<!doctype html><body><canvas id="c" width="128" height="128"></canvas></body>`,
    fn: (params: Record<string, number>, offsets: number[]) => {
      const K = (window as unknown as { KinoFx: Record<string, any> }).KinoFx;
      const canvas = document.getElementById("c") as HTMLCanvasElement;
      const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true })!;
      const pool = {
        acquire: (_g: unknown, w: number, h: number) => {
          const tex = gl.createTexture()!;
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
          const fbo = gl.createFramebuffer()!;
          gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          return { fbo, tex, w, h };
        },
        release: () => {},
        clear: (_g: unknown, t: { fbo: WebGLFramebuffer; w: number; h: number }) => {
          gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
          gl.viewport(0, 0, t.w, t.h);
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
        },
      };

      const c2d = document.createElement("canvas");
      c2d.width = 128;
      c2d.height = 128;
      const ctx = c2d.getContext("2d")!;
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, 128, 128);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(52, 52, 24, 24); // right edge at x = 76

      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, c2d);

      const src = { fbo: null as unknown as WebGLFramebuffer, tex, w: 128, h: 128 };
      const bloom = K.getPass("bloom");
      const out = K.runChain(gl, pool, src, [
        { pass: bloom, params: { ...params, axis: "x" } },
        { pass: bloom, params: { ...params, axis: "y" } },
      ], 0);
      return offsets.map((d) => {
        const px = new Uint8Array(4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
        gl.readPixels(76 + d, 64, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return [px[0], px[1], px[2]];
      });
    },
    args: [params, offsets],
  });
}

describe("bloom halation", () => {
  const base = { threshold: 0, intensity: 1, radius: 24 };

  it("is achromatic at halation 0 — a white source stays white all the way out", async () => {
    for (const [r, g, b] of await bloomSpread(base, [2, 12, 24])) {
      expect(g).toBe(r);
      expect(b).toBe(r);
    }
  }, 120000);

  it("omitting halation is byte-for-byte the same as halation 0", async () => {
    const offsets = [2, 8, 16, 24, 36];
    expect(await bloomSpread(base, offsets)).toEqual(await bloomSpread({ ...base, halation: 0 }, offsets));
  }, 120000);

  it("tightens the core and widens the skirt — blue leads at the source, red at distance", async () => {
    const [core, skirt] = await bloomSpread({ ...base, halation: 1 }, [2, 20]);
    // Per-channel normalisation moves energy, it does not add any: blue's narrower sigma packs
    // its share into the core, while red's spends it on the skirt.
    expect(core[2]).toBeGreaterThan(core[0]);
    expect(skirt[0]).toBeGreaterThan(skirt[2]);
  }, 120000);

  it("green sits between red and blue at distance", async () => {
    const [[r, g, b]] = await bloomSpread({ ...base, halation: 1 }, [16]);
    expect(g).toBeLessThan(r);
    expect(g).toBeGreaterThan(b);
  }, 120000);

  it("carries red past where the achromatic bloom has already died", async () => {
    // The tap offsets scale with red's sigma, so red is not truncated at the old radius — which
    // is the whole point of widening `span` alongside `sig` rather than just the weights.
    const [[plainR]] = await bloomSpread(base, [28]);
    const [[haloR]] = await bloomSpread({ ...base, halation: 1 }, [28]);
    expect(plainR).toBeLessThanOrEqual(1);
    expect(haloR).toBeGreaterThan(plainR);
  }, 120000);

  it("scales with the amount", async () => {
    const [[weakR]] = await bloomSpread({ ...base, halation: 0.3 }, [24]);
    const [[strongR]] = await bloomSpread({ ...base, halation: 1 }, [24]);
    expect(strongR).toBeGreaterThan(weakR);
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
