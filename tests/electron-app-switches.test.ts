import { describe, it, expect } from "vitest";
import { gpuSwitches } from "../src/render/native/electron/app.js";
import { hasDisplay } from "../src/render/native/sandbox.js";

const names = (sw: Array<string | [string, string]>) => sw.map((s) => (Array.isArray(s) ? s[0] : s));
const valueOf = (sw: Array<string | [string, string]>, key: string) =>
  sw.find((s): s is [string, string] => Array.isArray(s) && s[0] === key)?.[1];

describe("electron gpu switches", () => {
  it("adds sandbox flags on linux in a container", () => {
    const sw = gpuSwitches({}, "linux", { uid: 0, dockerEnv: true });
    expect(names(sw)).toContain("no-sandbox");
    expect(names(sw)).toContain("disable-gpu-sandbox");
  });

  it("omits sandbox flags on a normal linux desktop session", () => {
    const sw = gpuSwitches({}, "linux", { uid: 1000, dockerEnv: false });
    expect(names(sw)).not.toContain("no-sandbox");
  });

  it("honours an explicit KINO_NO_SANDBOX=0 even in a container", () => {
    const sw = gpuSwitches({ KINO_NO_SANDBOX: "0" }, "linux", { uid: 0, dockerEnv: true });
    expect(names(sw)).not.toContain("no-sandbox");
  });

  it("keeps win32 unconditionally sandboxless — session-0 GPU crashes", () => {
    expect(names(gpuSwitches({}, "win32", {}))).toContain("no-sandbox");
  });

  it("never adds sandbox flags on darwin", () => {
    expect(names(gpuSwitches({}, "darwin", {}))).not.toContain("no-sandbox");
  });

  it("selects the vulkan ANGLE backend on linux", () => {
    expect(valueOf(gpuSwitches({}, "linux", {}), "use-angle")).toBe("vulkan");
    expect(valueOf(gpuSwitches({}, "darwin", {}), "use-angle")).toBe("metal");
    expect(valueOf(gpuSwitches({}, "win32", {}), "use-angle")).toBe("d3d11");
  });
});

describe("hasDisplay", () => {
  it("is always true off linux — the check is a linux X11 concern", () => {
    expect(hasDisplay({}, "darwin")).toBe(true);
    expect(hasDisplay({}, "win32")).toBe(true);
  });

  it("is false on a linux box with no display, which is the xvfb-run case", () => {
    expect(hasDisplay({}, "linux")).toBe(false);
  });

  it("accepts either X11 or wayland", () => {
    expect(hasDisplay({ DISPLAY: ":99" }, "linux")).toBe(true);
    expect(hasDisplay({ WAYLAND_DISPLAY: "wayland-0" }, "linux")).toBe(true);
  });
});
