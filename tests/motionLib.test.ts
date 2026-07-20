import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { listMotionIds, resolveMotionSource, MOTION_LIB_DIR } from "../src/media/motionLib.js";
import { resolveMotionGraphic } from "../src/render/motiongraphic.js";

describe("motionLib", () => {
  it("lists bundled Tier-2 UI pages", () => {
    const ids = listMotionIds();
    expect(ids).toEqual(expect.arrayContaining(["prompt-type", "json-type", "build-pipeline", "loop-ready"]));
    expect(MOTION_LIB_DIR.endsWith(join("assets-lib", "motion"))).toBe(true);
  });

  it("resolves a bare id to the library file", () => {
    const fake = { assetPath: (rel: string) => join("/nope", rel) };
    const r = resolveMotionSource("prompt-type", fake);
    expect(r.abs).toContain("prompt-type.js");
    expect(r.display).toBe("prompt-type");
    expect(r.fileName).toBe("prompt-type.js");
  });

  it("throws on unknown bare id", () => {
    const fake = { assetPath: (rel: string) => join("/nope", rel) };
    expect(() => resolveMotionSource("not-a-real-motion", fake)).toThrow(/Unknown motion id/);
  });

  it("resolveMotionGraphic loads bare id without a project asset", () => {
    const fake = { assetPath: () => { throw new Error("should not hit project"); } };
    const g = resolveMotionGraphic({ source: "prompt-type" }, fake);
    expect(g.proc).toMatch(/MARK/);
  });

  it("path-like source uses project.assetPath", () => {
    const abs = join(MOTION_LIB_DIR, "prompt-type.js");
    const fake = { assetPath: (rel: string) => (rel === "motion/prompt-type.js" ? abs : join("/nope", rel)) };
    const r = resolveMotionSource("motion/prompt-type.js", fake);
    expect(r.abs).toBe(abs);
    expect(r.display).toBe("assets/motion/prompt-type.js");
  });
});
