import { describe, it, expect } from "vitest";
import { electronSpawnArgs } from "../src/render/native/electron/app.js";

describe("electronSpawnArgs", () => {
  it("emits sandbox flags as argv on linux-as-root — appendSwitch is too late there", () => {
    const a = electronSpawnArgs({}, "linux", { uid: 0, dockerEnv: true });
    expect(a).toContain("--no-sandbox");
    expect(a).toContain("--disable-gpu-sandbox");
  });

  it("emits the GPU flags as argv, or WebGL2 is blocklisted at page boot", () => {
    const a = electronSpawnArgs({}, "linux", {});
    expect(a).toContain("--enable-gpu");
    expect(a).toContain("--ignore-gpu-blocklist");
    expect(a).toContain("--use-angle=vulkan");
    expect(a).toContain("--use-gl=angle");
  });

  it("renders valued switches as --key=value", () => {
    expect(electronSpawnArgs({}, "darwin", {})).toContain("--use-angle=metal");
  });

  it("omits sandbox flags on a normal linux desktop session", () => {
    expect(electronSpawnArgs({}, "linux", { uid: 1000, dockerEnv: false })).not.toContain("--no-sandbox");
  });

  it("never uses --ozone-platform=headless — it starts electron but loses the GPU", () => {
    expect(electronSpawnArgs({}, "linux", {}).join(" ")).not.toContain("ozone-platform");
  });

  // KINO_ELECTRON_ARGS only worked through appendGpuSwitches, which is too late for GPU/sandbox
  // flags on Linux (see the comment on electronSpawnArgs) — so the debugging escape hatch was
  // silently ineffective on the platform that most needs it.
  it("mirrors the KINO_ELECTRON_ARGS escape hatch into argv", () => {
    const a = electronSpawnArgs({ KINO_ELECTRON_ARGS: "--foo --bar=1" }, "linux", {});
    expect(a).toContain("--foo");
    expect(a).toContain("--bar=1");
  });

  it("ignores a blank KINO_ELECTRON_ARGS and drops non-flag tokens", () => {
    const base = electronSpawnArgs({}, "linux", {});
    expect(electronSpawnArgs({ KINO_ELECTRON_ARGS: "" }, "linux", {})).toEqual(base);
    const a = electronSpawnArgs({ KINO_ELECTRON_ARGS: "notaflag --ok" }, "linux", {});
    expect(a).not.toContain("notaflag");
    expect(a).toContain("--ok");
    expect(a).toEqual([...base, "--ok"]);
  });
});
