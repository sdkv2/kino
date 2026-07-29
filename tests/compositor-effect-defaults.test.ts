import { describe, it, expect } from "vitest";
import { glowPass } from "../src/render/native/page/compositor/effects/glow.js";
import { bloomPass } from "../src/render/native/page/compositor/effects/bloom.js";
import { motionBlurPass } from "../src/render/native/page/compositor/effects/motionBlur.js";
import { blurPass } from "../src/render/native/page/compositor/effects/blur.js";
import { gradePass } from "../src/render/native/page/compositor/effects/grade.js";
import { lensPass } from "../src/render/native/page/compositor/effects/lens.js";
import type { EffectPass } from "../src/render/native/page/compositor/effects/pass.js";

// probeEffect's fixture is white on the left half, and white is 1.0 in both sRGB and linear — so
// no pixel probe through that harness can tell the thresholds apart. Assert the defaults directly.
//
// The passes call gl.uniform1f(loc.uThreshold, …). Hand them a `loc` whose every property is its
// own name, and a `gl` that records by that name, so the assertion reads the value the pass would
// have sent to the GPU with no browser involved.
function capture() {
  const got: Record<string, number> = {};
  const gl = {
    uniform1f: (name: string, v: number) => { got[name] = v; },
    uniform2f: () => {},
    uniform1i: (name: string, v: number) => { got[name] = v; },
    activeTexture: () => {},
    bindTexture: () => {},
  } as unknown as WebGL2RenderingContext;
  const loc = new Proxy({}, { get: (_t, k) => String(k) }) as Record<string, WebGLUniformLocation | null>;
  return { gl, loc, got };
}

describe("bright-pass defaults are linear-light luminance", () => {
  it("glow cuts at 0.32 linear, the same perceptual point as the old 0.60 sRGB", () => {
    const { gl, loc, got } = capture();
    glowPass.uniforms(gl, loc, {}, 0);
    expect(got.uThreshold).toBeCloseTo(0.32, 5);
  });

  it("bloom cuts at 0.45 linear, the same perceptual point as the old 0.70 sRGB", () => {
    const { gl, loc, got } = capture();
    bloomPass.uniforms(gl, loc, { axis: "x" }, 0);
    expect(got.uThreshold).toBeCloseTo(0.45, 5);
  });

  it("an authored threshold still overrides the default", () => {
    const { gl, loc, got } = capture();
    glowPass.uniforms(gl, loc, { threshold: 0.9 }, 0);
    expect(got.uThreshold).toBeCloseTo(0.9, 5);
  });
});

describe("motionBlur param clamps", () => {
  it("defaults distance 0, angle 0, samples 8", () => {
    const { gl, loc, got } = capture();
    motionBlurPass.uniforms(gl, loc, {}, 0);
    expect(got.uDistance).toBe(0);
    expect(got.uAngle).toBe(0);
    expect(got.uSamples).toBe(8);
  });

  it("clamps distance to 256 and samples to 32", () => {
    const { gl, loc, got } = capture();
    motionBlurPass.uniforms(gl, loc, { distance: 9999, samples: 100 }, 0);
    expect(got.uDistance).toBe(256);
    expect(got.uSamples).toBe(32);
  });

  it("floors samples at 1", () => {
    const { gl, loc, got } = capture();
    motionBlurPass.uniforms(gl, loc, { distance: 8, samples: 0 }, 0);
    expect(got.uSamples).toBe(1);
  });
});

// Effect params reach a pass straight off the spec: validateSegmentFx checks the effect KIND and
// that `params` is an object, but never the type of an individual value. So `{ radius: "wide" }`
// arrives as a string, Number() turns it into NaN, and NaN flows to the GPU — where cos(NaN) or a
// NaN radius paints undefined garbage instead of falling back to the documented default.
describe("non-numeric params fall back to the default instead of reaching the GPU as NaN", () => {
  const cases: Array<[string, EffectPass, Record<string, number | string>, string, number]> = [
    ["blur radius", blurPass, { radius: "wide" }, "uRadius", 0],
    ["glow radius", glowPass, { radius: "big" }, "uRadius", 8],
    ["glow intensity", glowPass, { intensity: "loud" }, "uIntensity", 1],
    ["grade brightness", gradePass, { brightness: "up" }, "uBrightness", 1],
    ["grade contrast", gradePass, { contrast: "punchy" }, "uContrast", 1],
    ["lens distortion", lensPass, { distortion: "warp" }, "uDistortion", 0],
    ["motionBlur angle", motionBlurPass, { angle: "sideways", distance: 10 }, "uAngle", 0],
    ["motionBlur distance", motionBlurPass, { distance: "far" }, "uDistance", 0],
  ];

  for (const [label, pass, params, uniform, expected] of cases) {
    it(`${label} survives a non-numeric value`, () => {
      const { gl, loc, got } = capture();
      pass.uniforms(gl, loc, params, 0);
      expect(got[uniform]).not.toBeNaN();
      expect(got[uniform]).toBeCloseTo(expected, 5);
    });
  }
});

// A push-in is a SCALE change, so the pixels move radially outward from the zoom centre — not
// along one fixed axis. Directional taps are right for a pan and wrong for a punch, so the pass
// carries both and layersAt drives them from the layer's own frame-to-frame motion.
describe("motionBlur radial term", () => {
  it("defaults to 0 so a pure pan is unaffected", () => {
    const { gl, loc, got } = capture();
    motionBlurPass.uniforms(gl, loc, { distance: 8 }, 0);
    expect(got.uRadial).toBe(0);
  });

  it("carries an authored radial amount", () => {
    const { gl, loc, got } = capture();
    motionBlurPass.uniforms(gl, loc, { radial: 0.04 }, 0);
    expect(got.uRadial).toBeCloseTo(0.04, 5);
  });

  it("clamps radial and survives a non-numeric value", () => {
    const { gl, loc, got } = capture();
    motionBlurPass.uniforms(gl, loc, { radial: 99 }, 0);
    expect(got.uRadial).toBe(1);
    const b = capture();
    motionBlurPass.uniforms(b.gl, b.loc, { radial: "lots" }, 0);
    expect(b.got.uRadial).toBe(0);
  });
});

describe("blur focal region defaults to off", () => {
  it("focusRadius 0 is the gate — a bare blur is spatially uniform", () => {
    const { gl, loc, got } = capture();
    blurPass.uniforms(gl, loc, { radius: 12 }, 0);
    expect(got.uFocusRadius).toBe(0);
  });

  it("centres the focal region and feathers it over 0.35 of frame height", () => {
    const { gl, loc, got } = capture();
    blurPass.uniforms(gl, loc, { radius: 12, focusRadius: 0.2 }, 0);
    expect(got.uFocusX).toBeCloseTo(0.5, 5);
    expect(got.uFocusY).toBeCloseTo(0.5, 5);
    expect(got.uFocusFeather).toBeCloseTo(0.35, 5);
    expect(got.uFalloff).toBeCloseTo(1, 5);
  });

  it("radial is mode 0 and band is mode 1", () => {
    const radial = capture();
    blurPass.uniforms(radial.gl, radial.loc, { focusRadius: 0.2 }, 0);
    expect(radial.got.uFocusMode).toBe(0);

    const band = capture();
    blurPass.uniforms(band.gl, band.loc, { focusRadius: 0.2, focusMode: "band" }, 0);
    expect(band.got.uFocusMode).toBe(1);
  });

  it("an unknown focusMode falls back to radial rather than to garbage", () => {
    const { gl, loc, got } = capture();
    blurPass.uniforms(gl, loc, { focusRadius: 0.2, focusMode: "sideways" }, 0);
    expect(got.uFocusMode).toBe(0);
  });

  it("converts focusAngle from degrees to radians", () => {
    const { gl, loc, got } = capture();
    blurPass.uniforms(gl, loc, { focusRadius: 0.2, focusMode: "band", focusAngle: 90 }, 0);
    expect(got.uFocusAngle).toBeCloseTo(Math.PI / 2, 5);
  });
});
