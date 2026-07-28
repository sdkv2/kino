// Pure Linux/sandbox environment probes, shared by the parent process (slots.ts, doctor.ts) and
// the Electron main process (electron/app.ts). Deliberately dependency-free: electron/app.ts loads
// inside the Electron main process, which must not import parent-side modules just to decide
// whether Chromium's sandbox can initialise. hasDisplay and nvidiaDrmModeset below aren't strictly
// "sandbox" checks either, but they're the same shape of thing (a pure, injectable read of Linux
// render-host state consumed by doctor.ts and the electron capture path), so they live here rather
// than fragmenting into a module per probe.
import { existsSync, readFileSync } from "node:fs";

/** Probe inputs for sandbox detection — injected so the decision stays pure and testable. */
export interface SandboxProbe {
  uid?: number;
  dockerEnv?: boolean;
}

/** Whether Chrome's sandbox can initialise here. It cannot as root, nor where unprivileged user
 *  namespaces are blocked (most container runtimes) — Chrome aborts in the zygote host with
 *  "Failed to move to new namespace" before any page loads, so every containerised or CI render
 *  needs --no-sandbox. Explicit KINO_NO_SANDBOX always wins. */
export function needsNoSandbox(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  probe: SandboxProbe = {},
): boolean {
  if (env.KINO_NO_SANDBOX === "1") return true;
  if (env.KINO_NO_SANDBOX === "0") return false;
  if (platform === "darwin" || platform === "win32") return false;
  const uid = probe.uid ?? (typeof process.getuid === "function" ? process.getuid() : undefined);
  const inContainer = probe.dockerEnv ?? (existsSync("/.dockerenv") || existsSync("/run/.containerenv"));
  return uid === 0 || inContainer;
}

/** Linux hardware GL needs a real X/Wayland display. --ozone-platform=headless starts Electron
 *  but yields NO_WEBGL2 on every ANGLE backend, so it is not a substitute — measured on an
 *  RTX 3060 Ti. Callers should require xvfb-run rather than managing an X server themselves. */
export function hasDisplay(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform !== "linux") return true;
  return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
}

const NVIDIA_DRM_MODESET_PATH = "/sys/module/nvidia_drm/parameters/modeset";

/** Three states, not two — "not applicable" must never collapse into "disabled". A Mac, a Windows
 *  box, or a Linux box with no NVIDIA driver at all reports `unknown`; only a real `N` reading from
 *  the sysfs file is `disabled`. Conflating them would report a non-fact (a "broken" prerequisite on
 *  hardware that never had it). */
export type ModesetStatus = "enabled" | "disabled" | "unknown";

/** Whether NVIDIA's `nvidia_drm` kernel module has `modeset=1`. This is a **host kernel module
 *  parameter** — it cannot be set from inside a container. Chromium's `GbmSupportX11` gets its DRM
 *  fd via DRI3, and NVIDIA's X driver offers no DRI3 without this flag; proven by elimination across
 *  Xvfb, headless Wayland, and a real Xorg+NVIDIA session (GL bound the real RTX 3060 and GBM still
 *  failed). Modeset=1 is
 *  NECESSARY but NOT SUFFICIENT: kino has no Linux shared-texture capture implementation at all yet,
 *  so this probe only ever answers "is the prerequisite present", never "does zero-copy work". */
export function nvidiaDrmModeset(
  platform: NodeJS.Platform = process.platform,
  readFile: (path: string) => string = (p) => readFileSync(p, "utf8"),
): ModesetStatus {
  if (platform !== "linux") return "unknown";
  let raw: string;
  try {
    raw = readFile(NVIDIA_DRM_MODESET_PATH);
  } catch {
    return "unknown"; // no nvidia_drm module loaded — not the same fact as "disabled"
  }
  const v = raw.trim();
  if (v === "Y") return "enabled";
  if (v === "N") return "disabled";
  return "unknown";
}
