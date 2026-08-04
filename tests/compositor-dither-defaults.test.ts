import { describe, it, expect } from "vitest";
import { ditherPass } from "../src/render/native/page/compositor/effects/dither.js";

// probeEffect's fixture can't see a dither (it reads single pixels, and a dither is defined by
// the DIFFERENCE between neighbouring pixels), so assert the pass's contract directly, the same
// way compositor-effect-defaults does for the other passes: what uniforms it would send, with no
// browser involved. The pixel-level behaviour lives in the GPU-scope test (compositor-dither).
function capture() {
  const got: Record<string, number> = {};
  const gl = {
    uniform1f: (name: string, v: number) => { got[name] = v; },
    uniform2f: () => {},
    uniform3f: () => {},
    uniform1i: () => {},
    activeTexture: () => {},
    bindTexture: () => {},
  } as unknown as WebGL2RenderingContext;
  const loc = new Proxy({}, { get: (_t, k) => String(k) }) as Record<string, WebGLUniformLocation | null>;
  return { gl, loc, got };
}

describe("ditherPass", () => {
  it("defaults to strength 0.5 (half an LSB) when the stage is present without params", () => {
    const { gl, loc, got } = capture();
    ditherPass.uniforms(gl, loc, {}, 0);
    expect(got.uStrength).toBe(0.5);
  });

  it("maps strength 0..1 to 0..1 LSBs", () => {
    const { gl, loc, got } = capture();
    ditherPass.uniforms(gl, loc, { strength: 1 }, 0);
    expect(got.uStrength).toBe(1);
    ditherPass.uniforms(gl, loc, { strength: 0 }, 0);
    expect(got.uStrength).toBe(0);
  });

  it("clamps out-of-range strength into 0..1 instead of sending garbage to the GPU", () => {
    const { gl, loc, got } = capture();
    ditherPass.uniforms(gl, loc, { strength: 5 }, 0);
    expect(got.uStrength).toBe(1);
    ditherPass.uniforms(gl, loc, { strength: -2 }, 0);
    expect(got.uStrength).toBe(0);
    ditherPass.uniforms(gl, loc, { strength: "wide" }, 0);
    expect(got.uStrength).toBe(0.5);
  });

  it("is deterministic — the shader depends on pixel position, never uFrame", () => {
    // The pass declares no frame-dependent inputs; its only uniform is strength. Assert that
    // contract so nobody "improves" it with a random/uniform-noise dither that would break the
    // compositor self-determinism test and the frame cache.
    expect(ditherPass.uniformNames).toEqual(["uStrength"]);
    expect(ditherPass.frag).not.toContain("uFrame");
    // …and it does NOT reference Math.random anywhere (it's GLSL; the point is the pattern is a
    // pure function of gl_FragCoord).
    expect(ditherPass.frag).toContain("gl_FragCoord");
  });
});
