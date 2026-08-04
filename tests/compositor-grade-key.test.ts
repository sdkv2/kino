// The grade pass's qualifier ("key") — the axis that decides WHERE a global grade lands.
//
// The fixture is four flat chips rather than compositor-grade-axes.test.ts's greyscale bands: a
// hue key is only legible on colour, and the whole point of the feature is that two chips of
// different hue take different amounts of the same grade. The neutral chip is load-bearing in the
// opposite direction — it is what proves a key aimed at the reds did not quietly claim every grey
// in the frame (hue is undefined at zero chroma, and the naive formula reports 0 there).
import { describe, it, expect, afterAll } from "vitest";
import { glProbe, closeGlHost } from "./helpers/glHost.js";
import { keyIsActive } from "../src/render/native/page/compositor/effects/grade.js";
import { validatePostFx } from "../src/render/postSpec.js";

afterAll(closeGlHost);

/** One chip's RGB after the pass, 0..255. */
type Chip = [number, number, number];
/** [neutral, green, red, desaturated-blue] — the fixture's four chips, in draw order. */
type Chips = [Chip, Chip, Chip, Chip];

function grade(params: Record<string, number>): Promise<Chips> {
  return glProbe<[Record<string, number>], Chips>({
    entry: "src/render/native/page/compositor/effects/index.ts",
    globalName: "KinoFx",
    html: `<!doctype html><body><canvas id="c" width="64" height="64"></canvas></body>`,
    fn: (params: Record<string, number>) => {
      const K = (window as unknown as { KinoFx: Record<string, any> }).KinoFx;
      const canvas = document.getElementById("c") as HTMLCanvasElement;
      const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true })!;

      // Minimal stand-in for TargetPool (not exported from the effects barrel) — same shape as
      // compositor-grade-axes.test.ts's, including the SRGB8_ALPHA8 target that makes the pass
      // see linear values exactly as a render does.
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
      // so the chip drawn FIRST (canvas top) is the one read at the LOWEST readPixels y. The
      // hue/sat each chip actually presents to the pass was measured through this exact fixture,
      // not computed from the hex: 144 / 5 / 211 degrees, saturation 0 / .78 / .74 / .16.
      const c2d = document.createElement("canvas");
      c2d.width = 64;
      c2d.height = 64;
      const ctx = c2d.getContext("2d")!;
      ctx.fillStyle = "#808080"; // neutral       hue n/a,  sat 0    -> read y 8
      ctx.fillRect(0, 0, 64, 16);
      ctx.fillStyle = "#2ecc71"; // status green  hue ~144, sat .78  -> read y 24
      ctx.fillRect(0, 16, 64, 16);
      ctx.fillStyle = "#e74c3c"; // status red    hue ~5,   sat .74  -> read y 40
      ctx.fillRect(0, 32, 64, 16);
      ctx.fillStyle = "#6f7a85"; // dim UI chrome hue ~211, sat .16  -> read y 56
      ctx.fillRect(0, 48, 64, 16);

      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, c2d);

      const src = { fbo: null as unknown as WebGLFramebuffer, tex, w: 64, h: 64 };
      const out = K.runChain(gl, pool, src, [{ pass: K.getPass("grade"), params }], 0);
      const at = (y: number): [number, number, number] => {
        const px = new Uint8Array(4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
        gl.readPixels(32, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return [px[0], px[1], px[2]];
      };
      return [at(8), at(24), at(40), at(56)];
    },
    args: [params],
  });
}

/** Largest per-channel move between two readings of the same chip, in 8-bit levels. */
const moved = (a: Chip, b: Chip): number => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

/** A grade strong enough that "did this chip move?" is never a rounding question. */
const RAMP = { temperature: -0.8 };
/** Levels below which a chip counts as untouched — one level of encode rounding, plus one. */
const HELD = 2;
/** Levels above which a chip counts as clearly graded. */
const GRADED = 8;

describe("grade key: what it selects", () => {
  it("moves every chip when no key is set", async () => {
    const base = await grade({});
    const ramped = await grade(RAMP);
    for (const i of [0, 1, 2, 3]) expect(moved(base[i], ramped[i])).toBeGreaterThan(GRADED);
  }, 300000);

  it("grades ONLY the keyed hue band", async () => {
    const base = await grade({});
    // Green alone: band centred on the chip's hue, everything else left as shot.
    const keyed = await grade({ ...RAMP, keyHue: 145, keyRange: 40 });
    expect(moved(base[1], keyed[1])).toBeGreaterThan(GRADED);
    expect(moved(base[0], keyed[0])).toBeLessThanOrEqual(HELD);
    expect(moved(base[2], keyed[2])).toBeLessThanOrEqual(HELD);
  }, 300000);

  it("keyInvert protects the band and grades the rest — Relay 29's half of the ramp", async () => {
    const base = await grade({});
    const keyed = await grade({ ...RAMP, keyHue: 145, keyRange: 40, keyInvert: 1 });
    expect(moved(base[1], keyed[1])).toBeLessThanOrEqual(HELD);
    expect(moved(base[0], keyed[0])).toBeGreaterThan(GRADED);
    expect(moved(base[2], keyed[2])).toBeGreaterThan(GRADED);
  }, 300000);

  it("protects the greens AND the reds at once — the reason there are two bands", async () => {
    const base = await grade({});
    const keyed = await grade({ ...RAMP, keyHue: 145, keyRange: 40, keyHue2: 5, keyRange2: 30, keyInvert: 1 });
    expect(moved(base[1], keyed[1])).toBeLessThanOrEqual(HELD);
    expect(moved(base[2], keyed[2])).toBeLessThanOrEqual(HELD);
    // The chrome the ramp is FOR still ramps.
    expect(moved(base[0], keyed[0])).toBeGreaterThan(GRADED);
    expect(moved(base[3], keyed[3])).toBeGreaterThan(GRADED);
  }, 300000);

  it("a hue band never claims a neutral — hue is undefined at zero chroma", async () => {
    const base = await grade({});
    // Centred on red, where the naive hue formula parks every grey.
    const keyed = await grade({ ...RAMP, keyHue: 0, keyRange: 45 });
    expect(moved(base[2], keyed[2])).toBeGreaterThan(GRADED);
    expect(moved(base[0], keyed[0])).toBeLessThanOrEqual(HELD);
  }, 300000);

  it("keySat alone protects every saturated colour without naming a hue", async () => {
    const base = await grade({});
    const keyed = await grade({ ...RAMP, keySat: 0.45, keyInvert: 1 });
    expect(moved(base[1], keyed[1])).toBeLessThanOrEqual(HELD);
    expect(moved(base[2], keyed[2])).toBeLessThanOrEqual(HELD);
    // The neutral and the dim chrome are both below the floor, so both take the full ramp.
    expect(moved(base[0], keyed[0])).toBeGreaterThan(GRADED);
    expect(moved(base[3], keyed[3])).toBeGreaterThan(GRADED);
  }, 300000);

  it("widening the band brings a neighbouring hue in", async () => {
    const base = await grade({});
    const narrow = await grade({ ...RAMP, keyHue: 145, keyRange: 20 });
    const wide = await grade({ ...RAMP, keyHue: 145, keyRange: 140 });
    expect(moved(base[3], narrow[3])).toBeLessThanOrEqual(HELD);
    expect(moved(base[3], wide[3])).toBeGreaterThan(GRADED);
  }, 300000);

  it("feathers rather than cutting — a chip inside the falloff takes a partial move", async () => {
    const base = await grade({});
    const full = await grade({ ...RAMP, keyHue: 144, keyRange: 60, keySoft: 0.02 });
    // Same width, fully feathered, and centred 30 degrees off the green chip — half a band away,
    // so the chip should take roughly half the move rather than all of it or none.
    const soft = await grade({ ...RAMP, keyHue: 174, keyRange: 60, keySoft: 1 });
    const partial = moved(base[1], soft[1]);
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(moved(base[1], full[1]));
  }, 300000);
});

describe("grade key: identities", () => {
  it("is byte-identical to an unkeyed grade when no axis is set", async () => {
    expect(await grade({ ...RAMP, keyHue: 145, keySoft: 0.5 })).toEqual(await grade(RAMP));
  }, 300000);

  it("keyInvert with nothing to invert still grades the whole frame", async () => {
    expect(await grade({ ...RAMP, keyInvert: 1 })).toEqual(await grade(RAMP));
  }, 300000);

  it("a key on an otherwise-neutral grade changes nothing", async () => {
    expect(await grade({ keyHue: 145, keyRange: 40, keyInvert: 1 })).toEqual(await grade({}));
  }, 300000);
});

describe("keyIsActive", () => {
  it("is off at the defaults, and off for keyInvert alone", () => {
    expect(keyIsActive({ hueRange: 0, hueRange2: 0, sat: 0 })).toBe(false);
  });

  it("is on as soon as any one axis asks for something", () => {
    expect(keyIsActive({ hueRange: 10, hueRange2: 0, sat: 0 })).toBe(true);
    expect(keyIsActive({ hueRange: 0, hueRange2: 10, sat: 0 })).toBe(true);
    expect(keyIsActive({ hueRange: 0, hueRange2: 0, sat: 0.2 })).toBe(true);
  });
});

describe("postFx.grade key schema", () => {
  it("accepts the qualifier", () => {
    expect(
      validatePostFx({
        grade: { temperature: -0.6, keyHue: 145, keyRange: 40, keyHue2: 6, keyRange2: 30, keySat: 0.3, keySoft: 0.4, keyInvert: 1 },
      }),
    ).toEqual([]);
  });

  it("bounds a hue to the wheel and a range to a half-width", () => {
    expect(validatePostFx({ grade: { keyHue: 400 } })).toEqual([
      "postFx.grade.keyHue must be between 0 and 360 (got 400)",
    ]);
    expect(validatePostFx({ grade: { keyRange: 200 } })).toEqual([
      "postFx.grade.keyRange must be between 0 and 180 (got 200)",
    ]);
  });

  it("still rejects a misspelled key param", () => {
    expect(validatePostFx({ grade: { keyHues: 145 } })[0]).toContain("is not a parameter");
  });
});
