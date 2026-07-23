import { describe, it, expect } from "vitest";
import { assembleShaderSource, hexToVec3, resolveUniforms, fitTextureDims, extraParamNames } from "../../src/render/shaderSource.js";

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

describe("fitTextureDims", () => {
  it("leaves textures within the cap untouched", () => {
    expect(fitTextureDims(3840, 2160, 4096)).toEqual([3840, 2160]);
    expect(fitTextureDims(4096, 4096, 4096)).toEqual([4096, 4096]);
  });
  it("scales oversized textures down to the cap, preserving aspect", () => {
    expect(fitTextureDims(7680, 4320, 4096)).toEqual([4096, 2304]); // 8K → fits, 16:9 kept
    expect(fitTextureDims(8000, 6000, 4096)).toEqual([4096, 3072]); // 4:3 kept
  });
  it("clamps the long edge regardless of which axis it is", () => {
    expect(fitTextureDims(2000, 9000, 4096)).toEqual([910, 4096]);
  });
  it("never returns a zero dimension", () => {
    const [w, h] = fitTextureDims(100000, 1, 4096);
    expect(w).toBe(4096);
    expect(h).toBe(1);
  });
});

describe("kinoBackdrop helpers", () => {
  it("injects the cover-fit / mirror-wrap sampler helpers into every shader", () => {
    const src = assembleShaderSource(BODY);
    expect(src).toContain("vec4 kinoBackdrop(");
    expect(src).toContain("vec4 kinoBackdropOffset(");
    expect(src).toContain("kinoMirrorUV");
  });
});

describe("extraParamNames + u_ aliases", () => {
  it("collects sorted numeric non-reserved param names from base + keyframes, capped at 4", () => {
    expect(extraParamNames({ intensity: 0.5, push: 1 }, [{ params: { bloom: 0, colorA: "#fff" } }])).toEqual(["bloom", "push"]);
    const many = [{ params: { d: 1, a: 1, c: 1, b: 1, e: 1 } }];
    expect(extraParamNames({}, many)).toEqual(["a", "b", "c", "d"]); // sorted, sliced to 4
  });
  it("emits #define u_<name> uParamI in the SAME order resolveUniforms packs uParams", () => {
    const names = extraParamNames({}, [{ params: { push: 1, bloom: 0 } }]);
    const src = assembleShaderSource(BODY, names);
    expect(src).toContain("#define u_bloom uParam0");
    expect(src).toContain("#define u_push uParam1");
    // matches resolveUniforms: bloom→[0], push→[1]
    expect(resolveUniforms({ bloom: 7, push: 9 }, { frame: 0, fps: 30, width: 1, height: 1, pulse: 0 }, names).uParams.slice(0, 2)).toEqual([7, 9]);
  });
  it("packs by extraNames even when the frame dict is missing a key (no slot drift)", () => {
    const names = extraParamNames({}, [{ params: { bloom: 0, push: 1 } }]);
    // push alone would sort to uParam0 if we re-derived — aliases still say bloom→0, push→1
    expect(resolveUniforms({ push: 9 }, { frame: 0, fps: 30, width: 1, height: 1, pulse: 0 }, names).uParams.slice(0, 2)).toEqual([0, 9]);
  });
  it("skips names that are not valid GLSL identifiers", () => {
    const src = assembleShaderSource(BODY, ["bad-name", "ok"]);
    expect(src).not.toContain("bad-name");
    expect(src).toContain("#define u_ok");
  });
});
