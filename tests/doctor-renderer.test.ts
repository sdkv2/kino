import { describe, it, expect } from "vitest";
import { describeElectronHost, electronBinaryPath } from "../src/render/native/renderer.js";
import {
  describeDisplayCheck,
  describeModesetCheck,
  describeSharedLibsCheck,
} from "../src/commands/doctor.js";

// Electron renders everything now, so a missing host is fatal rather than a degradation — there is
// no headless-Chrome path left to point the user at.
describe("describeElectronHost", () => {
  it("warns actionably when electron is not installed at all", () => {
    const missing = () => {
      throw Object.assign(new Error("Cannot find module 'electron'"), { code: "MODULE_NOT_FOUND" });
    };
    const r = describeElectronHost(missing);
    expect(r.level).toBe("warn");
    expect(r.message).toMatch(/every render will fail/);
    expect(r.message).toMatch(/npm install/);
  });

  it("warns when the package resolved but its binary never downloaded", () => {
    const r = describeElectronHost(
      () => "/pkg/node_modules/electron/dist/electron",
      () => false,
    );
    expect(r.level).toBe("warn");
    expect(r.message).toMatch(/binary is missing/);
  });

  it("reports ok with the binary path when the host is installed", () => {
    const r = describeElectronHost(
      () => "/pkg/node_modules/electron/dist/electron",
      () => true,
    );
    expect(r.level).toBe("ok");
    expect(r.message).toContain("/pkg/node_modules/electron/dist/electron");
  });

  it("treats an empty resolution as missing rather than ok", () => {
    const r = describeElectronHost(
      () => "",
      () => true,
    );
    expect(r.level).toBe("warn");
  });

  // Exercises the real resolution the render host spawns through, without assuming electron is
  // installed: `npm i --omit=optional` skips it, and that is precisely the scenario
  // describeElectronHost exists to describe — this test must not hard-fail under it.
  it("resolves the real electron binary when installed, and degrades cleanly when it is not", () => {
    let bin: string | null = null;
    try {
      bin = electronBinaryPath();
    } catch {
      bin = null;
    }
    const host = describeElectronHost();
    if (bin) {
      expect(host.level).toBe("ok");
      expect(bin).toContain("electron");
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
