import { describe, it, expect } from "vitest";
import { join } from "node:path";
import {
  describeElectronHost,
  probeElectronInstall,
  type ElectronInstall,
} from "../src/render/native/renderer.js";
import {
  describeDisplayCheck,
  describeModesetCheck,
  describeSharedLibsCheck,
} from "../src/commands/doctor.js";

const install = (o: Partial<ElectronInstall>): ElectronInstall => ({
  installed: true,
  binPath: "/pkg/node_modules/electron/dist/electron",
  binOnDisk: true,
  ...o,
});

// Electron renders everything now, so a missing PACKAGE is fatal rather than a degradation — there
// is no headless-Chrome path left to point the user at. A missing BINARY is not fatal: since
// Electron 42 it downloads on first use, so that row must not claim renders will fail.
describe("describeElectronHost", () => {
  it("warns actionably when electron is not installed at all", () => {
    const r = describeElectronHost(() =>
      install({ installed: false, binPath: null, binOnDisk: false, error: "Cannot find module 'electron'" }),
    );
    expect(r.level).toBe("warn");
    expect(r.message).toMatch(/every render will fail/);
    expect(r.message).toMatch(/npm install/);
  });

  it("describes a not-yet-downloaded binary as pending, not as a broken install", () => {
    const r = describeElectronHost(() => install({ binPath: null, binOnDisk: false }));
    expect(r.level).toBe("warn");
    // The whole point of this row: it self-heals, so it must not claim renders will fail...
    expect(r.message).not.toMatch(/every render will fail/);
    expect(r.message).toMatch(/downloaded|download/i);
    // ...and must not suggest reinstalling, which cannot help — there is no install script left.
    expect(r.message).not.toMatch(/reinstall/i);
    expect(r.message).toMatch(/install-electron/);
  });

  it("treats a resolvable path that is not on disk the same as never downloaded", () => {
    const r = describeElectronHost(() => install({ binOnDisk: false }));
    expect(r.level).toBe("warn");
    expect(r.message).toMatch(/install-electron/);
  });

  it("reports ok with the binary path when the host is fully installed", () => {
    const r = describeElectronHost(() => install({}));
    expect(r.level).toBe("ok");
    expect(r.message).toContain("/pkg/node_modules/electron/dist/electron");
  });
});

// A diagnostic must not install anything. Before Electron 42 this was free — the postinstall had
// already run — but `require("electron")` now downloads ~100MB, so doctor has to read the install
// rather than resolve through it.
describe("probeElectronInstall", () => {
  it("reads path.txt without executing electron's index.js", () => {
    const seen: string[] = [];
    const r = probeElectronInstall(
      {},
      (p) => {
        seen.push(p);
        return true;
      },
      () => "Electron.app/Contents/MacOS/Electron\n",
    );
    expect(r.installed).toBe(true);
    expect(r.binOnDisk).toBe(true);
    expect(r.binPath).toContain(join("dist", "Electron.app", "Contents", "MacOS", "Electron"));
    // path.txt is consulted; nothing resolves through require("electron") itself.
    expect(seen.some((p) => p.endsWith("path.txt"))).toBe(true);
  });

  it("reports installed-but-not-downloaded when path.txt is absent", () => {
    const r = probeElectronInstall(
      {},
      () => false,
      () => {
        throw new Error("should not read a file that does not exist");
      },
    );
    expect(r.installed).toBe(true);
    expect(r.binOnDisk).toBe(false);
    expect(r.binPath).toBeNull();
  });

  it("honours ELECTRON_OVERRIDE_DIST_PATH so a prebuilt dist isn't misreported as missing", () => {
    const r = probeElectronInstall(
      { ELECTRON_OVERRIDE_DIST_PATH: "/opt/electron" },
      () => true,
      () => "electron\n",
    );
    expect(r.binPath).toBe(join("/opt/electron", "electron"));
    expect(r.binOnDisk).toBe(true);
  });

  // Runs against the real tree. Must not hard-fail when electron is absent (`npm i --omit=optional`)
  // — that is exactly the state this function exists to describe.
  it("describes the real install without downloading anything", () => {
    const r = probeElectronInstall();
    const host = describeElectronHost();
    if (r.installed && r.binOnDisk) {
      expect(host.level).toBe("ok");
      expect(r.binPath).toContain("electron");
    } else {
      expect(host.level).toBe("warn");
    }
  });
});

// The Linux electron path boots headless-but-with-a-GPU-process, which needs a real X/Wayland
// display — see sandbox.ts's hasDisplay and its "why not --ozone-platform=headless" comment.
// Without this row, a missing display only ever surfaced as an unexplained 60s awaitBoot timeout.
describe("describeDisplayCheck", () => {
  it("is ok off linux regardless of DISPLAY — hasDisplay is a linux-only concern", () => {
    const r = describeDisplayCheck({}, "darwin");
    expect(r.level).toBe("ok");
  });

  it("warns with the xvfb-run remediation when linux has no display", () => {
    const r = describeDisplayCheck({}, "linux");
    expect(r.level).toBe("warn");
    expect(r.message).toMatch(/xvfb-run/);
  });

  it("is ok on linux once DISPLAY or WAYLAND_DISPLAY is set", () => {
    expect(describeDisplayCheck({ DISPLAY: ":99" }, "linux").level).toBe("ok");
    expect(describeDisplayCheck({ WAYLAND_DISPLAY: "wayland-0" }, "linux").level).toBe("ok");
  });
});

// A bare container image (e.g. nvidia/cuda) has Electron's binary but not the shared libraries
// Chromium dlopens at startup — that fails as `error while loading shared libraries: libnspr4.so`,
// which `ldd` reports as a "not found" line well before any render is attempted.
describe("describeSharedLibsCheck", () => {
  it("reports ok when ldd resolves every dependency", async () => {
    const r = await describeSharedLibsCheck("/opt/electron/electron", async () => "\tlibc.so.6 => /lib/libc.so.6 (0x00007f)\n");
    expect(r.level).toBe("ok");
  });

  it("warns and names the missing libs plus an apt-get remediation", async () => {
    const lddOutput =
      "\tlibnspr4.so => not found\n\tlibnss3.so => not found\n\tlibc.so.6 => /lib/libc.so.6 (0x00007f)\n";
    const r = await describeSharedLibsCheck("/opt/electron/electron", async () => lddOutput);
    expect(r.level).toBe("warn");
    expect(r.message).toMatch(/libnspr4/);
    expect(r.message).toMatch(/libnss3/);
    expect(r.message).toMatch(/apt-get install/);
  });

  it("does not fail the whole check when ldd itself is unavailable", async () => {
    const r = await describeSharedLibsCheck("/opt/electron/electron", async () => {
      throw new Error("spawn ldd ENOENT");
    });
    expect(r.level).toBe("ok");
  });
});

// nvidia-drm.modeset gates DRI3 gates Chromium's GbmSupportX11. Two accuracy constraints this row must honour:
// (1) modeset=1 is necessary but NOT sufficient for zero-copy capture — kino has no Linux
// shared-texture implementation at all, so the "ok" case must not imply "and it works now".
// (2) modeset=N is not a fault — Linux `auto` resolves to the faster `direct` path today, so the
// disabled case must be informational, never a warning.
describe("describeModesetCheck", () => {
  it("reports ok for enabled, but is explicit that zero-copy capture isn't implemented yet", () => {
    const r = describeModesetCheck("enabled");
    expect(r).not.toBeNull();
    expect(r!.level).toBe("ok");
    expect(r!.message).toMatch(/modeset/);
    expect(r!.message).toMatch(/not implemented|does not implement|not built/i);
  });

  it("reports disabled as informational, not a warning — direct is faster today, nothing is broken", () => {
    const r = describeModesetCheck("disabled");
    expect(r).not.toBeNull();
    expect(r!.level).toBe("info");
    expect(r!.level).not.toBe("warn");
    expect(r!.message).toMatch(/direct/);
    expect(r!.message).toMatch(/sudo/);
    expect(r!.message).toMatch(/modprobe|modeset=1/);
    expect(r!.message).toMatch(/container/);
  });

  it("omits the row entirely when there is no NVIDIA driver (unknown) rather than reporting a non-fact", () => {
    expect(describeModesetCheck("unknown")).toBeNull();
  });
});
