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

// Regression guard for the crash diagnosed 2026-07-28: every spawned Electron shared one default
// profile, whose block-file HTTP cache is not concurrency-safe. Corruption persisted on disk, so
// every subsequent launch segfaulted on CacheThread_BlockFile until the directory was deleted.
describe("electronSpawnArgs user-data-dir", () => {
  it("passes a private profile through when one is given", () => {
    const a = electronSpawnArgs({}, "darwin", {}, "/tmp/kino-electron-profile-abc");
    expect(a).toContain("--user-data-dir=/tmp/kino-electron-profile-abc");
  });

  it("omits the flag entirely when no profile is given, rather than sending an empty path", () => {
    const a = electronSpawnArgs({}, "darwin", {});
    expect(a.some((s) => s.startsWith("--user-data-dir"))).toBe(false);
  });

  it("keeps the profile flag distinct per host so two hosts never share a cache", () => {
    const a = electronSpawnArgs({}, "darwin", {}, "/tmp/p1");
    const b = electronSpawnArgs({}, "darwin", {}, "/tmp/p2");
    expect(a).toContain("--user-data-dir=/tmp/p1");
    expect(b).toContain("--user-data-dir=/tmp/p2");
    expect(a).not.toEqual(b);
  });
});
