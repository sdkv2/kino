import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { listBackgroundIds, resolveBackgroundComponent, BACKGROUND_LIB_DIR } from "../src/media/backgroundLib.js";

const project = {
  workspaceRoot: "/tmp/kino-bg-test",
  assetPath(rel: string) {
    return `/tmp/kino-bg-test/assets/${rel}`;
  },
} as import("../src/config/project.js").Project;

describe("backgroundLib", () => {
  it("lists bundled draw-fn ids", () => {
    expect(listBackgroundIds()).toContain("brand-wash");
    expect(existsSync(BACKGROUND_LIB_DIR)).toBe(true);
  });
  it("resolves bare id to assets-lib", () => {
    const abs = resolveBackgroundComponent("brand-wash", project);
    expect(abs.endsWith("brand-wash.js")).toBe(true);
    expect(existsSync(abs)).toBe(true);
  });
  it("throws on unknown bare id", () => {
    expect(() => resolveBackgroundComponent("nope-not-real", project)).toThrow(/Unknown background id/);
  });
});
