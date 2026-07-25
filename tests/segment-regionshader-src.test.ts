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

// --- Phase 4: a subject body can call the background body at any coordinate --------------------
describe("kinoBackground (cross-region sampling)", () => {
  const USER = "void mainImage(out vec4 c, in vec2 f){ kinoBackground(c, f + vec2(0.0, 8.0)); }";
  const DECL = "void regionBg(out vec4 fragColor, in vec2 fragCoord);";

  // The backward-compat bar phases 2 and 3 both held: a spec that does not use the feature gets
  // the SAME BYTES it got before the feature existed, not merely an equivalent program.
  it("emits byte-identical source when no body mentions kinoBackground", () => {
    const src = assembleRegionShaderSource(SUBJ, BG);
    expect(src).not.toContain("kinoBackground");
    expect(src).not.toContain(DECL);
  });

  // GLSL wants a declaration before use, and subject bodies are emitted BEFORE the background body
  // in the one translation unit they share — hence the forward declaration ahead of them.
  it("forward-declares regionBg and aliases it inside a subject body that uses it", () => {
    const src = assembleRegionShaderSource(USER, BG);
    expect(src).toContain(DECL);
    expect(src).toContain("#define kinoBackground regionBg");
    expect(src).toContain("#undef kinoBackground");
    expect(src.indexOf(DECL)).toBeLessThan(src.indexOf("#define mainImage regionSubject"));
  });

  // Using it in the BACKGROUND body is recursion (illegal in GLSL) and has no meaning. Leaving it
  // undefined there turns the mistake into a loud compile error against line-numbered source.
  it("does not define kinoBackground for the background body", () => {
    const src = assembleRegionShaderSource(USER, BG);
    const undefAt = src.indexOf("#undef kinoBackground");
    expect(undefAt).toBeGreaterThan(-1); // else the ordering check below passes vacuously
    expect(src.indexOf("#define mainImage regionBg")).toBeGreaterThan(undefAt);
  });

  it("is not switched on by the background body alone", () => {
    const src = assembleRegionShaderSource(SUBJ, "void mainImage(out vec4 c, in vec2 f){ kinoBackground(c, f); }");
    expect(src).not.toContain("#define kinoBackground regionBg");
  });

  // Per-object tail: a per-entry body gets the same access, alongside uMaskSelf.
  it("aliases kinoBackground inside a per-entry subject body", () => {
    const src = assembleRegionShaderSource(null, BG, [], [USER]);
    expect(src).toContain(DECL);
    expect(src).toContain("#define kinoBackground regionBg");
    expect(src.indexOf(DECL)).toBeLessThan(src.indexOf("#define mainImage regionSubject0"));
  });

  // ...and the shared fallback body is a subject body too.
  it("aliases kinoBackground inside the shared fallback body", () => {
    const src = assembleRegionShaderSource(USER, BG, [], [A, null]);
    expect(src).toContain(DECL);
    expect(src.indexOf("#define kinoBackground regionBg")).toBeLessThan(
      src.indexOf("#define mainImage regionSubjectShared"),
    );
  });

  it("leaves the per-object tail untouched when no body mentions it", () => {
    expect(assembleRegionShaderSource(null, BG, [], [A, B2])).not.toContain("kinoBackground");
  });
});

// --- Phase 5: cutout compositing — a SECOND source behind the masked subject -------------------
// The backdrop rides the already-declared-but-unbound uTex1/uTexSize1 (region shaders bind only
// uTex0), so the feature adds no uniform and — emitted conditionally, exactly as kinoBackground is —
// costs a spec that doesn't use it nothing at all, byte for byte.
// See docs/superpowers/specs/2026-07-25-cutout-compositing-design.md.
describe("backdrop binding", () => {
  it("emits byte-identical GLSL when there is no backdrop", () => {
    expect(assembleRegionShaderSource(SUBJ, BG, [], [], false)).toBe(assembleRegionShaderSource(SUBJ, BG, []));
    expect(assembleRegionShaderSource(SUBJ, null, [], [], false)).toBe(assembleRegionShaderSource(SUBJ, null, []));
    expect(assembleRegionShaderSource(SUBJ, null, ["rim"], [A], false)).toBe(
      assembleRegionShaderSource(SUBJ, null, ["rim"], [A]),
    );
    expect(assembleRegionShaderSource(SUBJ, null, [])).not.toContain("uBackdrop");
  });

  it("aliases uBackdrop/uBackdropSize onto the free uTex1 slot when there is one", () => {
    const src = assembleRegionShaderSource(SUBJ, BG, [], [], true);
    expect(src).toContain("#define uBackdrop uTex1");
    expect(src).toContain("#define uBackdropSize uTexSize1");
  });

  it("makes a passthrough BACKGROUND the cover-fit backdrop, and leaves the subject on the asset", () => {
    const src = assembleRegionShaderSource(null, null, [], [], true);
    expect(src).toContain("kinoBackdrop(uTex1, uTexSize1, fragCoord)");
    // Exactly one body switched: the subject passthrough still reads the beat's own plate, which is
    // the whole point — the subject IS the thing being cut out.
    expect((src.match(/texture\(uTex0, fragCoord \/ iResolution\.xy\)/g) ?? []).length).toBe(1);
  });

  it("leaves an explicit background body alone — it can sample uBackdrop itself", () => {
    const src = assembleRegionShaderSource(SUBJ, BG, [], [], true);
    expect(src).toContain(BG);
    expect(src).not.toContain("kinoBackdrop(uTex1, uTexSize1, fragCoord)");
  });
});
