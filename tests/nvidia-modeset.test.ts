import { describe, it, expect } from "vitest";
import { nvidiaDrmModeset } from "../src/render/native/sandbox.js";

// in turn gates Chromium's GbmSupportX11. The probe must tell apart three states — enabled, disabled, and "not
// applicable" (no NVIDIA driver, or not Linux at all) — because conflating "no NVIDIA" with
// "disabled" would misreport a Mac/AMD/Intel box as having a broken prerequisite it never had.
describe("nvidiaDrmModeset", () => {
  it("reports enabled when the sysfs file reads Y", () => {
    expect(nvidiaDrmModeset("linux", () => "Y\n")).toBe("enabled");
  });

  it("reports disabled when the sysfs file reads N", () => {
    expect(nvidiaDrmModeset("linux", () => "N\n")).toBe("disabled");
  });

  it("reports unknown when the file is absent (no NVIDIA driver) rather than disabled", () => {
    expect(
      nvidiaDrmModeset("linux", () => {
        throw Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" });
      }),
    ).toBe("unknown");
  });

  it("reports unknown on non-linux platforms regardless of the file reader", () => {
    expect(nvidiaDrmModeset("darwin", () => "Y")).toBe("unknown");
    expect(nvidiaDrmModeset("win32", () => "Y")).toBe("unknown");
  });

  it("uses the real filesystem by default on linux (no crash when the file is absent)", () => {
    // On the dev/CI box this almost certainly has no nvidia_drm module loaded, so this exercises
    // the real ENOENT path through the default readFile, not a mock.
    expect(["enabled", "disabled", "unknown"]).toContain(nvidiaDrmModeset("linux"));
  });
});
