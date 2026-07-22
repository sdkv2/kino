import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MOTION_LIB_DIR, listMotionIds } from "../src/media/motionLib.js";
import { lintSceneJs, extractSceneAssets } from "../src/render/scene.js";

const presets = ["phone-orbit", "depth-particles", "wordmark-3d"];

describe("3d scene presets", () => {
  it("all presets are listed", () => {
    for (const id of presets) expect(listMotionIds()).toContain(id);
  });
  it("all presets pass the scene lint", () => {
    for (const id of presets) {
      expect(lintSceneJs(readFileSync(join(MOTION_LIB_DIR, `${id}.scene.js`), "utf8"))).toEqual([]);
    }
  });
  it("phone-orbit declares its screenshot via api.param", () => {
    const src = readFileSync(join(MOTION_LIB_DIR, "phone-orbit.scene.js"), "utf8");
    const r = extractSceneAssets(src, { screenshot: "shots/x.png" });
    expect(r.assets).toEqual(["shots/x.png"]);
    expect(r.violations).toEqual([]);
  });
  it("depth-particles and wordmark-3d reference no assets", () => {
    for (const id of ["depth-particles", "wordmark-3d"]) {
      const r = extractSceneAssets(readFileSync(join(MOTION_LIB_DIR, `${id}.scene.js`), "utf8"), {});
      expect(r.assets).toEqual([]);
      expect(r.violations).toEqual([]);
    }
  });
});
