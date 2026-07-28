import { describe, it, expect } from "vitest";
import { glowPass } from "../src/render/native/page/compositor/effects/glow.js";
import { bloomPass } from "../src/render/native/page/compositor/effects/bloom.js";

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
    uniform1i: () => {},
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
