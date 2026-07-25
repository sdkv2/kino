import { describe, it, expect } from "vitest";
import { assembleRegionShaderSource, extraParamNames } from "../src/render/shaderSource.js";

const SUBJ = "void mainImage(out vec4 c, in vec2 f){ c = vec4(1.0); }";
const BG = "void mainImage(out vec4 c, in vec2 f){ c = vec4(uColorA, 1.0); }";

describe("assembleRegionShaderSource", () => {
  it("namespaces both bodies, binds every uMaskN, and mixes bg→subject", () => {
    const src = assembleRegionShaderSource(SUBJ, null, []);
    expect(src.startsWith("#version 300 es")).toBe(true);
    expect(src).toContain("regionSubject");
    expect(src).toContain("regionBg");
    expect(src).toContain("uniform sampler2D uMask0;");
    expect(src).toContain("uniform sampler2D uMask3;"); // MAX_REGION_MASKS = 4
    expect(src).toContain("mix(");
    // exactly one entry point
    expect((src.match(/void main\(\)/g) ?? []).length).toBe(1);
  });

  it("passthrough (null side) samples uTex0", () => {
    const src = assembleRegionShaderSource(SUBJ, null, []);
    expect(src).toContain("texture(uTex0");
  });

  it("both non-null: both bodies present under a single main()", () => {
    const src = assembleRegionShaderSource(SUBJ, BG, []);
    expect(src).toContain(SUBJ);
    expect(src).toContain(BG);
    expect((src.match(/void main\(\)/g) ?? []).length).toBe(1);
  });

  it("injects kinoMaskDist so region bodies can read distance to the mask edge", () => {
    const src = assembleRegionShaderSource(SUBJ, null, []);
    expect(src).toContain("float kinoMaskDist(sampler2D mask, vec4 channel, vec2 fragCoord, float radius)");
  });
});

const A = "void mainImage(out vec4 c, in vec2 f){ c = vec4(1.0, 0.0, 0.0, 1.0); }";
const B2 = "void mainImage(out vec4 c, in vec2 f){ c = vec4(0.0, 1.0, 0.0, 1.0); }";

describe("assembleRegionShaderSource per-object regions", () => {
  // Nobody pays for a feature they didn't use: byte-for-byte the same program, not merely an
  // equivalent one. A spec on the union path must not re-render differently after this change.
  it("emits the union source unchanged when no mask carries its own body", () => {
    expect(assembleRegionShaderSource(SUBJ, BG, [], [])).toBe(assembleRegionShaderSource(SUBJ, BG, []));
    expect(assembleRegionShaderSource(SUBJ, BG, [], [null, null])).toBe(assembleRegionShaderSource(SUBJ, BG, []));
    expect(assembleRegionShaderSource(SUBJ, BG, [])).toContain("m = max(m, dot(texture(uMask0, muv), uChannel0));");
  });

  it("gives each mask its own function and composites in array order", () => {
    const src = assembleRegionShaderSource(null, BG, [], [A, B2]);
    expect(src).toContain("#define mainImage regionSubject0");
    expect(src).toContain("#define mainImage regionSubject1");
    expect(src).toContain(A);
    expect(src).toContain(B2);
    // Painter's order: mask 0 composited first, so mask 1 paints OVER it where they overlap.
    const i0 = src.indexOf("c = mix(c, s0, smoothstep(0.4, 0.6, dot(texture(uMask0, muv), uChannel0)));");
    const i1 = src.indexOf("c = mix(c, s1, smoothstep(0.4, 0.6, dot(texture(uMask1, muv), uChannel1)));");
    expect(i0).toBeGreaterThan(-1);
    expect(i1).toBeGreaterThan(i0);
    expect(src).not.toContain("m = max(m,"); // the union reduce is gone on this path
    expect((src.match(/void main\(\)/g) ?? []).length).toBe(1);
  });

  it("defines uMaskSelf/uChannelSelf inside a per-entry body only", () => {
    const src = assembleRegionShaderSource(null, BG, [], [A, B2]);
    expect(src).toContain("#define uMaskSelf uMask0");
    expect(src).toContain("#define uChannelSelf uChannel0");
    expect(src).toContain("#define uMaskSelf uMask1");
    expect(src).toContain("#define uChannelSelf uChannel1");
    expect((src.match(/#undef uMaskSelf/g) ?? []).length).toBe(2); // scoped per body, never leaks
  });

  it("emits the shared fallback body once, and only when some mask needs it", () => {
    const both = assembleRegionShaderSource(SUBJ, BG, [], [A, B2]);
    expect(both).not.toContain(SUBJ); // nothing falls back → don't compile or run it
    expect(both).not.toContain("regionSubjectShared");

    const mixed = assembleRegionShaderSource(SUBJ, BG, [], [A, null, null]);
    expect(mixed).toContain("#define mainImage regionSubjectShared");
    expect((mixed.match(/regionSubjectShared\(/g) ?? []).length).toBe(1); // called once, used twice
    expect(mixed).toContain("c = mix(c, sShared, smoothstep(0.4, 0.6, dot(texture(uMask1, muv), uChannel1)));");
    expect(mixed).toContain("c = mix(c, sShared, smoothstep(0.4, 0.6, dot(texture(uMask2, muv), uChannel2)));");
  });

  it("ignores mask slots beyond MAX_REGION_MASKS", () => {
    const src = assembleRegionShaderSource(null, BG, [], [A, A, A, A, A]);
    expect(src).not.toContain("uMask4");
  });
});

// --- Phase 3: author params shared across every body in the one program ------------------------
describe("region shader extra params", () => {
  // Nobody pays for a feature they didn't use. Byte-for-byte, not merely equivalent.
  it("emits an identical program when there are no params", () => {
    expect(assembleRegionShaderSource(SUBJ, BG, extraParamNames({}, []), [])).toBe(
      assembleRegionShaderSource(SUBJ, BG, []),
    );
    // colorA is RESERVED — it drives uColorA, never a uParam slot, so it must not add an alias.
    expect(assembleRegionShaderSource(SUBJ, BG, extraParamNames({ colorA: "#fff" }, []), [])).toBe(
      assembleRegionShaderSource(SUBJ, BG, []),
    );
  });

  it("aliases named params into uParam slots in sorted order", () => {
    const names = extraParamNames({ rim: 1 }, [{ params: { blur: 2 } }]);
    expect(names).toEqual(["blur", "rim"]);
    const src = assembleRegionShaderSource(SUBJ, BG, names, []);
    expect(src).toContain("#define u_blur uParam0");
    expect(src).toContain("#define u_rim uParam1");
  });

  // The shared bank: ONE alias set serves the subject, the background and every per-mask body.
  it("shares one alias set across per-object bodies", () => {
    const src = assembleRegionShaderSource(null, BG, extraParamNames({ rim: 1 }, []), [A, B2]);
    expect((src.match(/#define u_rim uParam0/g) ?? []).length).toBe(1);
    expect(src).toContain("#define mainImage regionSubject1");
  });
});
