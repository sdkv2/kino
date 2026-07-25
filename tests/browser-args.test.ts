import { describe, it, expect } from "vitest";
import { glMode, launchArgs } from "../src/render/native/browser.js";

describe("launchArgs", () => {
  const shared = [
    "--force-color-profile=srgb",
    "--force-device-scale-factor=1",
    "--hide-scrollbars",
    "--mute-audio",
  ];

  it("defaults to SwiftShader WebGL (software)", () => {
    const args = launchArgs({}, "darwin");
    expect(args).toContain("--use-angle=swiftshader-webgl");
    expect(args).toContain("--enable-unsafe-swiftshader");
    expect(args.some((a) => a.startsWith("--use-angle=metal"))).toBe(false);
    for (const f of shared) expect(args).toContain(f);
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

  it("glMode tags cache backend", () => {
    expect(glMode({})).toBe("sw");
    expect(glMode({ KINO_GPU: "1" })).toBe("gpu");
  });
});
