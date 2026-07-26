import { describe, it, expect } from "vitest";
import { glMode, launchArgs, needsNoSandbox, resolveGL } from "../src/render/native/browser.js";

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

  // A valueless `--use-angle` is a no-op: Chrome needs an explicit backend, and headless Linux
  // silently lands on SwiftShader (measured 1.39fps vs 13.32fps hardware — 9.6x). Probed on an
  // RTX 2070 SUPER: only `vulkan` binds the NVIDIA GPU; bare and `gl` both report SwiftShader.
  it("KINO_GPU=1 selects the Vulkan ANGLE backend on linux", () => {
    const args = launchArgs({ KINO_GPU: "1" }, "linux");
    expect(args).toContain("--use-angle=vulkan");
    expect(args).not.toContain("--use-angle");
    expect(args).not.toContain("--use-angle=metal");
    expect(args).not.toContain("--use-angle=swiftshader-webgl");
  });

  it("KINO_GPU=1 selects the D3D11 ANGLE backend on win32", () => {
    const args = launchArgs({ KINO_GPU: "1" }, "win32");
    expect(args).toContain("--use-angle=d3d11");
    expect(args).not.toContain("--use-angle");
  });
});

// Chrome's setuid+userns sandbox cannot initialise as root, nor where unprivileged user
// namespaces are blocked (most container runtimes) — it aborts in the zygote host before any
// page loads. Every hosted/CI render needs this.
describe("needsNoSandbox", () => {
  it("is false for an ordinary desktop user", () => {
    expect(needsNoSandbox({}, "linux", { uid: 501, dockerEnv: false })).toBe(false);
    expect(needsNoSandbox({}, "darwin", { uid: 501, dockerEnv: false })).toBe(false);
  });

  it("is true when running as root on linux", () => {
    expect(needsNoSandbox({}, "linux", { uid: 0, dockerEnv: false })).toBe(true);
  });

  it("is true inside a container even as a non-root user", () => {
    expect(needsNoSandbox({}, "linux", { uid: 1000, dockerEnv: true })).toBe(true);
  });

  it("honours an explicit KINO_NO_SANDBOX in both directions", () => {
    expect(needsNoSandbox({ KINO_NO_SANDBOX: "1" }, "darwin", { uid: 501, dockerEnv: false })).toBe(true);
    expect(needsNoSandbox({ KINO_NO_SANDBOX: "0" }, "linux", { uid: 0, dockerEnv: true })).toBe(false);
  });
});

describe("launchArgs sandbox + escape hatch", () => {
  it("adds --no-sandbox when the sandbox cannot initialise", () => {
    const args = launchArgs({}, "linux", { uid: 0, dockerEnv: true });
    expect(args).toContain("--no-sandbox");
    expect(args).toContain("--disable-setuid-sandbox");
  });

  it("leaves the sandbox on for an ordinary desktop user", () => {
    const args = launchArgs({}, "linux", { uid: 501, dockerEnv: false });
    expect(args).not.toContain("--no-sandbox");
  });

  it("appends KINO_CHROME_ARGS so any flag can be injected without a code change", () => {
    const args = launchArgs({ KINO_CHROME_ARGS: "--foo=1  --bar" }, "linux", { uid: 501, dockerEnv: false });
    expect(args).toContain("--foo=1");
    expect(args).toContain("--bar");
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
