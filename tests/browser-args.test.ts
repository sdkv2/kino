import { describe, it, expect } from "vitest";
import { glMode, launchArgs, resolveGL } from "../src/render/native/browser.js";

describe("launchArgs", () => {
  const shared = [
    "--force-color-profile=srgb",
    "--force-device-scale-factor=1",
    "--hide-scrollbars",
    "--mute-audio",
  ];

  it("defaults to SwiftShader WebGL (software) off darwin", () => {
    const args = launchArgs({}, "linux");
    expect(args).toContain("--use-angle=swiftshader-webgl");
    expect(args).toContain("--enable-unsafe-swiftshader");
    expect(args.some((a) => a.startsWith("--use-angle=metal"))).toBe(false);
    for (const f of shared) expect(args).toContain(f);
  });

  it("defaults to Metal ANGLE on darwin", () => {
    const args = launchArgs({}, "darwin");
    expect(args).toContain("--use-angle=metal");
    expect(args).not.toContain("--use-angle=swiftshader-webgl");
    expect(args).not.toContain("--enable-unsafe-swiftshader");
    for (const f of shared) expect(args).toContain(f);
  });

  it("KINO_GPU=0 forces SwiftShader even on darwin", () => {
    const args = launchArgs({ KINO_GPU: "0" }, "darwin");
    expect(args).toContain("--use-angle=swiftshader-webgl");
    expect(args).toContain("--enable-unsafe-swiftshader");
    expect(args).not.toContain("--use-angle=metal");
  });

  it("KINO_GPU=1 uses Metal ANGLE on darwin", () => {
    const args = launchArgs({ KINO_GPU: "1" }, "darwin");
    expect(args).toContain("--use-angle=metal");
    expect(args).not.toContain("--use-angle=swiftshader-webgl");
    expect(args).not.toContain("--enable-unsafe-swiftshader");
    for (const f of shared) expect(args).toContain(f);
  });

  it("KINO_GPU=1 uses bare ANGLE on non-darwin", () => {
    const args = launchArgs({ KINO_GPU: "1" }, "linux");
    expect(args).toContain("--use-angle");
    expect(args).not.toContain("--use-angle=metal");
    expect(args).not.toContain("--use-angle=swiftshader-webgl");
  });
});

describe("resolveGL", () => {
  // Auto-detect is a platform rule, not a probe: macOS always has Metal, everything else is a
  // coin flip whose failure mode (dead GL context → flat wash) is silent. See resolveGL's comment.
  it("auto-detects gpu on darwin, sw elsewhere", () => {
    expect(resolveGL({}, "darwin")).toBe("gpu");
    expect(resolveGL({}, "linux")).toBe("sw");
    expect(resolveGL({}, "win32")).toBe("sw");
  });

  it("explicit KINO_GPU wins over the platform in both directions", () => {
    expect(resolveGL({ KINO_GPU: "0" }, "darwin")).toBe("sw");
    expect(resolveGL({ KINO_GPU: "1" }, "linux")).toBe("gpu");
  });

  it("glMode tags the cache with the resolved backend", () => {
    expect(glMode({}, "linux")).toBe("sw");
    expect(glMode({}, "darwin")).toBe("gpu");
    expect(glMode({ KINO_GPU: "1" }, "linux")).toBe("gpu");
    expect(glMode({ KINO_GPU: "0" }, "darwin")).toBe("sw");
  });
});
