import { describe, it, expect } from "vitest";
import {
  nativeEncodeAvailable,
  reconcileCapture,
  resolveElectronCapture,
} from "../src/render/native/electron/gpuCapture.js";

describe("linux capture mode", () => {
  it("auto resolves to direct even when the NVENC addon is present — readback measured 2x slower", () => {
    expect(resolveElectronCapture({}, "linux", true)).toBe("direct");
  });

  it("auto falls back to direct with no addon — current behaviour preserved", () => {
    expect(resolveElectronCapture({}, "linux", false)).toBe("direct");
  });

  it("explicit readback opt-in still resolves on linux — benchmarking access must survive the default flip", () => {
    expect(resolveElectronCapture({ KINO_ELECTRON_CAPTURE: "readback" }, "linux", true)).toBe("readback");
  });

  it("rejects an explicit shared request on linux, naming readback", () => {
    expect(() => resolveElectronCapture({ KINO_ELECTRON_CAPTURE: "shared" }, "linux", true)).toThrow(
      /readback/,
    );
  });

  // not just say "unsupported".
  // It must also never imply that satisfying the prerequisites makes shared capture work. They are
  // satisfiable — a modeset=Y host does deliver OSR textures — but Chromium never writes the
  // buffer it delivers, so the message has to name the upstream break, not a missing local
  // implementation, or the next reader wastes a week writing capture code against empty frames.
  it("names the upstream break, not just a missing implementation, even when modeset is enabled", () => {
    expect(() =>
      resolveElectronCapture({ KINO_ELECTRON_CAPTURE: "shared" }, "linux", true, "enabled"),
    ).toThrow(/never writes|empty/i);
    expect(() =>
      resolveElectronCapture({ KINO_ELECTRON_CAPTURE: "shared" }, "linux", true, "enabled"),
    ).toThrow(/electron#49247/);
    expect(() =>
      resolveElectronCapture({ KINO_ELECTRON_CAPTURE: "shared" }, "linux", true, "enabled"),
    ).toThrow(/not implemented|does not implement|no Linux shared-texture/i);
  });

  it("names the disabled modeset as the actionable fact when the probe reports it", () => {
    expect(() =>
      resolveElectronCapture({ KINO_ELECTRON_CAPTURE: "shared" }, "linux", true, "disabled"),
    ).toThrow(/disabled/i);
  });

  it("errors on an explicit readback request with no addon", () => {
    expect(() => resolveElectronCapture({ KINO_ELECTRON_CAPTURE: "readback" }, "linux", false)).toThrow(
      /npm run build:native/,
    );
  });

  it("leaves darwin and win32 resolving to shared", () => {
    expect(resolveElectronCapture({}, "darwin", true)).toBe("shared");
    expect(resolveElectronCapture({}, "win32", true)).toBe("shared");
  });

  it("reports native encode availability per platform", () => {
    expect(nativeEncodeAvailable("linux", true)).toBe(true);
    expect(nativeEncodeAvailable("linux", false)).toBe(false);
    expect(nativeEncodeAvailable("freebsd", true)).toBe(false);
  });
});

// resolveElectronCapture only knows the .node FILE exists — the parent must not dlopen it. The
// worker then finds out whether it really loads, and the two answers have to reconcile without
// turning a working render into exit 1.
describe("reconcileCapture (worker-side, addon actually loaded)", () => {
  it("degrades an auto-resolved readback to direct when the addon will not load", () => {
    // The Linux addon builds and loads on a driverless box reporting available() === false. That
    // must be a fallback, not a crash — it is what the phase-1 acceptance test renders against.
    expect(reconcileCapture("readback", false, {})).toBe("direct");
  });

  it("degrades an auto-resolved shared the same way", () => {
    expect(reconcileCapture("shared", false, {})).toBe("direct");
  });

  it("keeps the resolved mode when the addon loaded", () => {
    expect(reconcileCapture("readback", true, {})).toBe("readback");
    expect(reconcileCapture("shared", true, {})).toBe("shared");
  });

  it("still throws when the mode was explicitly requested", () => {
    expect(() => reconcileCapture("readback", false, { KINO_ELECTRON_CAPTURE: "readback" })).toThrow(
      /gpu_capture native module did not load/,
    );
    expect(() => reconcileCapture("shared", false, { KINO_ELECTRON_CAPTURE: "shared" })).toThrow(
      /gpu_capture native module did not load/,
    );
  });

  it("leaves modes that need no native module alone", () => {
    expect(reconcileCapture("direct", false, { KINO_ELECTRON_CAPTURE: "direct" })).toBe("direct");
    expect(reconcileCapture("page", false, { KINO_ELECTRON_CAPTURE: "page" })).toBe("page");
  });
});
