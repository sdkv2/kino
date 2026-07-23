import { describe, it, expect } from "vitest";
import { assembleShaderSource, hexToVec3, resolveUniforms } from "../../src/render/shaderSource.js";

const BODY = "void mainImage(out vec4 fragColor, in vec2 fragCoord){ fragColor = vec4(uColorA, 1.0); }";

describe("assembleShaderSource", () => {
  it("prepends version, precision, uniforms, and a main() that calls mainImage", () => {
    const src = assembleShaderSource(BODY);
    expect(src.startsWith("#version 300 es")).toBe(true);
    expect(src).toContain("precision highp float;");
    for (const u of ["iResolution", "iTime", "iFrame", "iTimeDelta", "uPulse", "uColorA", "uColorB", "uColorC", "uIntensity", "uParam0", "uParam3"]) {
      expect(src).toContain(`uniform`);
      expect(src).toContain(u);
    }
    expect(src).toContain(BODY);
    expect(src).toContain("void main()");
    expect(src).toContain("mainImage(kino_fragColor, gl_FragCoord.xy)");
  });
});

describe("hexToVec3", () => {
  it("parses #rrggbb to normalized rgb", () => {
    const [r, g, b] = hexToVec3("#ff8000");
    expect(r).toBeCloseTo(1, 5);
    expect(g).toBeCloseTo(0.50196, 4);
    expect(b).toBeCloseTo(0, 5);
  });
  it("expands #rgb shorthand", () => {
    expect(hexToVec3("#0f0")).toEqual([0, 1, 0]);
  });
  it("falls back to white on garbage", () => {
    expect(hexToVec3("not-a-color")).toEqual([1, 1, 1]);
  });
});

describe("resolveUniforms", () => {
  const params = { colorA: "#ff0000", colorB: "#00ff00", colorC: "#0000ff", intensity: 0.7, speed: 2, wobble: 0.3 };
  const ctx = { frame: 48, fps: 24, width: 1080, height: 1920, pulse: 0.5 };

  it("derives iTime/iFrame from the frame index only", () => {
    const u = resolveUniforms(params, ctx);
    expect(u.iTime).toBeCloseTo(2, 6);
    expect(u.iFrame).toBe(48);
    expect(u.iTimeDelta).toBeCloseTo(1 / 24, 6);
    expect(u.iResolution).toEqual([1080, 1920, 1]);
  });
  it("is a pure function of frame (same frame -> identical values)", () => {
    expect(resolveUniforms(params, ctx)).toEqual(resolveUniforms(params, { ...ctx }));
  });
  it("maps color params through hexToVec3 and passes intensity/pulse", () => {
    const u = resolveUniforms(params, ctx);
    expect(u.uColorA).toEqual([1, 0, 0]);
    expect(u.uIntensity).toBeCloseTo(0.7, 6);
    expect(u.uPulse).toBeCloseTo(0.5, 6);
  });
  it("maps extra numeric params (sorted by key, reserved excluded) into uParams[0..3]", () => {
    const u = resolveUniforms(params, ctx);
    expect(u.uParams).toEqual([2, 0.3, 0, 0]);
  });
  it("guards fps=0", () => {
    const u = resolveUniforms(params, { ...ctx, fps: 0 });
    expect(u.iTime).toBe(0);
    expect(u.iTimeDelta).toBe(0);
  });
});
