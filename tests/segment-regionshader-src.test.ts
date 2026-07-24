import { describe, it, expect } from "vitest";
import { assembleRegionShaderSource } from "../src/render/shaderSource.js";

const SUBJ = "void mainImage(out vec4 c, in vec2 f){ c = vec4(1.0); }";
const BG = "void mainImage(out vec4 c, in vec2 f){ c = vec4(uColorA, 1.0); }";

describe("assembleRegionShaderSource", () => {
  it("namespaces both bodies, binds uMask, and mixes bg→subject", () => {
    const src = assembleRegionShaderSource(SUBJ, null, []);
    expect(src.startsWith("#version 300 es")).toBe(true);
    expect(src).toContain("regionSubject");
    expect(src).toContain("regionBg");
    expect(src).toContain("uniform sampler2D uMask;");
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
});
