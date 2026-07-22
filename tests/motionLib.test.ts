import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "node:path";
import { writeFileSync, rmSync } from "node:fs";
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

describe("scene source resolution", () => {
  // Fixtures live in the real MOTION_LIB_DIR (findInLib/listMotionIds are not injectable);
  // written on setup, removed on teardown so the bundled library stays clean.
  const fixtures = ["orbit.scene.js", "dup.js", "dup.scene.js", "fly.scene.js"];
  const project = { assetPath: (rel: string) => join(MOTION_LIB_DIR, rel.split("/").pop()!) };

  beforeAll(() => {
    for (const f of fixtures) writeFileSync(join(MOTION_LIB_DIR, f), "return () => {}");
  });
  afterAll(() => {
    for (const f of fixtures) rmSync(join(MOTION_LIB_DIR, f), { force: true });
  });

  it("resolves a bare id to <id>.scene.js in the library", () => {
    const r = resolveMotionSource("orbit", project);
    expect(r.fileName).toBe("orbit.scene.js");
    expect(r.display).toBe("orbit");
  });

  it("lists scene ids without extension", () => {
    expect(listMotionIds()).toContain("orbit");
  });

  it("throws on ambiguous <id>.js + <id>.scene.js", () => {
    expect(() => resolveMotionSource("dup", project)).toThrow(/ambiguous/i);
  });

  it("resolves a project-path .scene.js", () => {
    const r = resolveMotionSource("motion/fly.scene.js", project);
    expect(r.fileName).toBe("fly.scene.js");
  });
});
