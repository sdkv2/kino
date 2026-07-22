import { describe, it, expect } from "vitest";
import { launchArgs } from "../src/render/native/browser.js";

// launchArgs is a pure function of the env so both branches are testable without launching Chrome.
// darwin gets ANGLE's Metal backend; every other platform gets bare --use-angle (its default backend).
const angleFlag = process.platform === "darwin" ? "--use-angle=metal" : "--use-angle";

describe("launchArgs", () => {
  it("default (software) mode disables the GPU and enables SwiftShader, no ANGLE", () => {
    const args = launchArgs({});
    expect(args).toContain("--disable-gpu");
    expect(args).toContain("--enable-unsafe-swiftshader");
    expect(args.some((a) => a.startsWith("--use-angle"))).toBe(false);
  });

  it("KINO_GPU=1 drops the software flags and adds the platform's ANGLE flag", () => {
    const args = launchArgs({ KINO_GPU: "1" });
    expect(args).not.toContain("--disable-gpu");
    expect(args).not.toContain("--enable-unsafe-swiftshader");
    expect(args).toContain(angleFlag);
    // exactly one --use-angle* flag, and it's the right one for this platform
    expect(args.filter((a) => a.startsWith("--use-angle"))).toEqual([angleFlag]);
  });

  it("keeps the shared determinism flags in BOTH modes", () => {
    for (const env of [{}, { KINO_GPU: "1" }]) {
      const args = launchArgs(env);
      expect(args).toContain("--force-color-profile=srgb");
      expect(args).toContain("--force-device-scale-factor=1");
    }
  });
});
