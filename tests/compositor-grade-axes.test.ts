// The grade pass's colour-temperature and lift/gamma/gain axes, on real pixels.
//
// The fixture is three flat bands rather than probeEffect's orange chip: a white balance is only
// legible on a NEUTRAL (an orange chip has no blue to take away), and lift/gamma/gain each act on
// a different part of the range, so the assertions need a floor, a midtone and a top separately.
import { describe, it, expect, afterAll } from "vitest";
import { glProbe, closeGlHost } from "./helpers/glHost.js";
import { whiteBalanceGain } from "../src/render/native/page/compositor/effects/grade.js";
import { validatePostFx } from "../src/render/postSpec.js";

afterAll(closeGlHost);

/** [greyR, greyG, greyB, darkR, whiteR] in 0..255 after one grade pass. */
type Bands = [number, number, number, number, number];

function grade(params: Record<string, number>): Promise<Bands> {
  return glProbe<[Record<string, number>], Bands>({
    entry: "src/render/native/page/compositor/effects/index.ts",
    globalName: "KinoFx",
    html: `<!doctype html><body><canvas id="c" width="64" height="64"></canvas></body>`,
    fn: (params: Record<string, number>) => {
      const K = (window as unknown as { KinoFx: Record<string, any> }).KinoFx;
      const canvas = document.getElementById("c") as HTMLCanvasElement;
      const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true })!;

      // Minimal stand-in for TargetPool (not exported from the effects barrel).
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

      // Canvas rows go top-down, readPixels rows go bottom-up, and the upload is not flipped —
      // so the band drawn FIRST (canvas top) is the one read at the LOWEST readPixels y.
      const c2d = document.createElement("canvas");
      c2d.width = 64;
      c2d.height = 64;
      const ctx = c2d.getContext("2d")!;
      ctx.fillStyle = "#808080";
      ctx.fillRect(0, 0, 64, 32); // midtone   -> read y 0..31
      ctx.fillStyle = "#141414";
      ctx.fillRect(0, 32, 64, 16); // near black -> read y 32..47
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 48, 64, 16); // white      -> read y 48..63

      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, c2d);

      const src = { fbo: null as unknown as WebGLFramebuffer, tex, w: 64, h: 64 };
      const out = K.runChain(gl, pool, src, [{ pass: K.getPass("grade"), params }], 0);
      const at = (y: number) => {
        const px = new Uint8Array(4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
        gl.readPixels(32, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return px;
      };
      const grey = at(16);
      return [grey[0], grey[1], grey[2], at(40)[0], at(56)[0]];
    },
    args: [params],
  });
}

describe("grade fixture", () => {
  it("passes the three bands through untouched at the defaults", async () => {
    const [r, g, b, dark, white] = await grade({});
    expect([r, g, b]).toEqual([128, 128, 128]);
    expect(dark).toBe(20);
    expect(white).toBe(255);
  }, 300000);
});

describe("grade: white balance", () => {
  it("a positive temperature raises red relative to blue", async () => {
    const [r, , b] = await grade({ temperature: 0.6 });
    expect(r).toBeGreaterThan(b + 8);
  }, 300000);

  it("a negative temperature does the reverse, symmetrically", async () => {
    const warm = await grade({ temperature: 0.6 });
    const cool = await grade({ temperature: -0.6 });
    expect(cool[2]).toBeGreaterThan(cool[0] + 8);
    // Mirror image about the neutral: warm's red split == cool's blue split, within rounding.
    expect(Math.abs(warm[0] - warm[2] - (cool[2] - cool[0]))).toBeLessThanOrEqual(2);
  }, 300000);

  it("temperature moves colour, not exposure — the neutral keeps its luma", async () => {
    const neutral = await grade({});
    const warm = await grade({ temperature: 0.6 });
    const luma = (p: Bands) => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];
    // Rec.601-normalised gains, measured through the sRGB encode: a couple of levels, not tens.
    expect(Math.abs(luma(warm) - luma(neutral))).toBeLessThan(4);
  }, 300000);

  it("a positive tint pushes magenta — green drops below both red and blue", async () => {
    const [r, g, b] = await grade({ tint: 0.6 });
    expect(g).toBeLessThan(r);
    expect(g).toBeLessThan(b);
  }, 300000);

  it("a negative tint pushes green — green rises above both", async () => {
    const [r, g, b] = await grade({ tint: -0.6 });
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
  }, 300000);

  it("temperature 0 / tint 0 is identity", async () => {
    expect(await grade({ temperature: 0, tint: 0 })).toEqual(await grade({}));
  }, 300000);
});

describe("grade: lift / gamma / gain", () => {
  it("lift raises the floor and leaves the top alone", async () => {
    const base = await grade({});
    const lifted = await grade({ lift: 0.05 });
    expect(lifted[3]).toBeGreaterThan(base[3] + 10);
    expect(lifted[4]).toBe(255);
  }, 300000);

  it("gain scales the top", async () => {
    const base = await grade({});
    const down = await grade({ gain: 0.7 });
    expect(down[4]).toBeLessThan(base[4] - 20);
  }, 300000);

  it("gamma above 1 opens the midtones without moving the top", async () => {
    const base = await grade({});
    const open = await grade({ gamma: 1.6 });
    expect(open[0]).toBeGreaterThan(base[0] + 10);
    expect(open[4]).toBe(255);
  }, 300000);

  it("gamma below 1 closes them", async () => {
    const base = await grade({});
    const closed = await grade({ gamma: 0.7 });
    expect(closed[0]).toBeLessThan(base[0] - 10);
  }, 300000);

  it("lift 0 / gamma 1 / gain 1 is identity", async () => {
    expect(await grade({ lift: 0, gamma: 1, gain: 1 })).toEqual(await grade({}));
  }, 300000);

  it("every new axis at its default together is identity", async () => {
    const explicit = await grade({ temperature: 0, tint: 0, lift: 0, gamma: 1, gain: 1 });
    expect(explicit).toEqual(await grade({}));
  }, 300000);

  it("leaves the legacy trim exactly where it was", async () => {
    // brightness/contrast/saturation still run LAST and on the same values as before the new
    // stages existed, so a legacy grade is unchanged by their arrival.
    const [r, g, b] = await grade({ contrast: 1.2, saturation: 0.5, brightness: 1.1 });
    expect(r).toBeGreaterThan(0);
    expect(Math.abs(r - g)).toBeLessThanOrEqual(1);
    expect(Math.abs(g - b)).toBeLessThanOrEqual(1);
  }, 300000);
});

describe("whiteBalanceGain", () => {
  it("is exactly neutral at the defaults", () => {
    expect(whiteBalanceGain(0, 0)).toEqual([1, 1, 1]);
  });

  it("warms by raising the red/blue ratio and cools by lowering it", () => {
    const [wr, , wb] = whiteBalanceGain(1, 0);
    const [cr, , cb] = whiteBalanceGain(-1, 0);
    expect(wr / wb).toBeGreaterThan(1.6);
    expect(cr / cb).toBeLessThan(1 / 1.6);
  });

  it("holds Rec.601 luma at 1 so temperature is not a hidden exposure control", () => {
    for (const [t, ti] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.4, -0.7]]) {
      const [r, g, b] = whiteBalanceGain(t, ti);
      expect(0.299 * r + 0.587 * g + 0.114 * b).toBeCloseTo(1, 10);
    }
  });

  it("tints magenta by dropping green and green by raising it", () => {
    const [mr, mg, mb] = whiteBalanceGain(0, 1);
    expect(mg).toBeLessThan(mr);
    expect(mg).toBeLessThan(mb);
    const [gr, gg, gb] = whiteBalanceGain(0, -1);
    expect(gg).toBeGreaterThan(gr);
    expect(gg).toBeGreaterThan(gb);
  });

  it("keeps red and blue balanced against each other on a pure tint", () => {
    const [r, , b] = whiteBalanceGain(0, 0.8);
    expect(r).toBeCloseTo(b, 12);
  });
});

describe("postFx.grade schema", () => {
  it("accepts every new axis", () => {
    expect(validatePostFx({ grade: { temperature: -1, tint: 1, lift: -0.2, gamma: 2.2, gain: 0.8 } })).toEqual([]);
  });

  it("rejects an out-of-range axis by name", () => {
    expect(validatePostFx({ grade: { temperature: 2 } })).toEqual([
      "postFx.grade.temperature must be between -1 and 1 (got 2)",
    ]);
    expect(validatePostFx({ grade: { gamma: 0 } })).toEqual([
      "postFx.grade.gamma must be between 0.1 and 4 (got 0)",
    ]);
  });

  it("still rejects a param that is not an axis", () => {
    expect(validatePostFx({ grade: { warmth: 1 } })[0]).toContain("is not a parameter");
  });

  it("accepts bloom.halation and bounds it to 0..1", () => {
    expect(validatePostFx({ bloom: { halation: 1 } })).toEqual([]);
    expect(validatePostFx({ bloom: { halation: 1.5 } })).toEqual([
      "postFx.bloom.halation must be between 0 and 1 (got 1.5)",
    ]);
  });
});
