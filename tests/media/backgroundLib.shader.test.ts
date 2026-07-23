import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isShaderPath, resolveBackgroundComponent } from "../../src/media/backgroundLib.js";

describe("isShaderPath", () => {
  it("is true for .frag/.glsl and false for .js", () => {
    expect(isShaderPath("a/b/aurora-flow.frag")).toBe(true);
    expect(isShaderPath("x.glsl")).toBe(true);
    expect(isShaderPath("x.GLSL")).toBe(true);
    expect(isShaderPath("brand-wash.js")).toBe(false);
  });
});

describe("resolveBackgroundComponent — project shader path", () => {
  let ws: string;
  const project = () => ({
    assetPath: (rel: string) => join(ws, "assets", rel),
    workspaceRoot: ws,
  }) as any;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), "kino-bglib-"));
    mkdirSync(join(ws, "assets", "backgrounds"), { recursive: true });
  });
  afterEach(() => rmSync(ws, { recursive: true, force: true }));

  it("resolves a project-relative .frag path", () => {
    const p = join(ws, "assets", "backgrounds", "waves.frag");
    writeFileSync(p, "void mainImage(out vec4 c, in vec2 f){}");
    expect(resolveBackgroundComponent("backgrounds/waves.frag", project())).toBe(p);
    expect(isShaderPath(resolveBackgroundComponent("backgrounds/waves.frag", project()))).toBe(true);
  });
});
