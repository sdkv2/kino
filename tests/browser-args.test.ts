import { describe, it, expect } from "vitest";
import { launchArgs } from "../src/render/native/browser.js";

// launchArgs is a pure function of the env, so the deterministic flag surface is testable without
// launching Chrome. Rendering is pure 2D — the GPU is always disabled, no ANGLE, no SwiftShader.
describe("launchArgs", () => {
  it("disables the GPU and pins the deterministic surface, no ANGLE", () => {
    const args = launchArgs({});
    expect(args).toContain("--disable-gpu");
    expect(args).toContain("--force-color-profile=srgb");
    expect(args).toContain("--force-device-scale-factor=1");
    expect(args.some((a) => a.startsWith("--use-angle"))).toBe(false);
    expect(args).not.toContain("--enable-unsafe-swiftshader");
  });
});
