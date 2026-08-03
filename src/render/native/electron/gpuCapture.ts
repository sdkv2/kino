import { createRequire } from "node:module";
import { closeSync, existsSync, openSync, readSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nvidiaDrmModeset, type ModesetStatus } from "../sandbox.js";

const here = dirname(fileURLToPath(import.meta.url));

export type ElectronCaptureMode = "shared" | "readback" | "direct" | "page" | "auto";
/** A resolved capture backend — `auto` has been decided by the time this is used. */
export type CaptureKind = "shared" | "readback" | "direct" | "page";

export interface GpuCaptureNative {
  available(): boolean;
  /** Create a VT session; concurrent windows each hold their own id for parallel encode. */
  initEncoder(width: number, height: number, fps: number): number;
  encodeSharedTexture(
    sessionId: number,
    handle: Buffer,
    width: number,
    height: number,
    pixelFormat: "bgra" | "rgba" | "rgbaf16" | "nv12",
    outWidth?: number,
    outHeight?: number,
  ): Buffer;
  /** Thread-pool VT encode — overlaps with the next seek/paint on the main thread. */
  encodeSharedTextureAsync(
    sessionId: number,
    handle: Buffer,
    width: number,
    height: number,
    pixelFormat: "bgra" | "rgba" | "rgbaf16" | "nv12",
    outWidth?: number,
    outHeight?: number,
  ): Promise<Buffer>;
  /** WebGL readPixels path: RGBA (+ optional Y-flip) → VT on the thread pool. */
  encodeRgbaAsync(
    sessionId: number,
    rgba: Buffer,
    width: number,
    height: number,
    flipY?: boolean,
    outWidth?: number,
    outHeight?: number,
  ): Promise<Buffer>;
  encodeBitmap(
    sessionId: number,
    bgra: Buffer,
    width: number,
    height: number,
    outWidth?: number,
    outHeight?: number,
  ): Buffer;
  shutdownEncoder(sessionId: number): void;
  /** Free/total VRAM. Present on the Linux backend; optional elsewhere. */
  gpuLimits?(): { vramFreeBytes: number; vramTotalBytes: number };
}

let cached: GpuCaptureNative | null | undefined;
let resolvedPath: string | null | undefined;

/** `linux-x64`, `darwin-arm64`, `win32-x64` … the prebuild key. Not ABI-qualified on purpose: the
 *  addon is pure N-API, so one binary per platform+arch serves every Node/Electron version. */
const PREBUILD_TRIPLE = `${process.platform}-${process.arch}`;

function nodePath(): string | null {
  if (resolvedPath !== undefined) return resolvedPath;
  let dir = here;
  for (let i = 0; i < 8; i++) {
    const candidates = [
      // Per-platform prebuilds first. A triple that does not match this machine is simply not
      // found, which is the whole point — unlike the single build/Release artifact below, which is
      // present on every platform but only loadable on the one that produced it.
      join(dir, `prebuilds/${PREBUILD_TRIPLE}/gpu_capture.node`),
      join(dir, `native/prebuilds/${PREBUILD_TRIPLE}/gpu_capture.node`),
      // Local build output — what `npm run build:native` leaves behind for the current machine.
      join(dir, "native/build/Release/gpu_capture.node"),
      join(dir, "src/render/native/electron/native/build/Release/gpu_capture.node"),
    ];
    for (const p of candidates) {
      if (existsSync(p)) {
        resolvedPath = p;
        return p;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  resolvedPath = null;
  return null;
}

export function gpuCaptureMode(env: NodeJS.ProcessEnv = process.env): ElectronCaptureMode {
  const v = env.KINO_ELECTRON_CAPTURE;
  if (v === "shared" || v === "readback" || v === "direct" || v === "page" || v === "auto") return v;
  return "auto";
}

/** True when the native encode addon is usable here. NOTE: this means "the addon loads", NOT
 *  "shared-texture capture works" — on Linux those differ, because phase 1 ships NVENC via the
 *  readback path only. Callers wanting the latter must check the resolved capture mode.
 *
 *  `hasAddon` defaults to the artifact merely EXISTING, because the parent Node process must not
 *  dlopen it — the addon is built against Electron's ABI and would abort a plain node. Whether it
 *  actually loads and reports a usable encoder is only knowable inside the Electron worker, which
 *  is what `reconcileCapture` below exists to settle. */
export function nativeEncodeAvailable(
  platform: NodeJS.Platform = process.platform,
  hasAddon: boolean = nodePath() != null,
): boolean {
  return (platform === "darwin" || platform === "win32" || platform === "linux") && hasAddon;
}

/** Load IOSurface→VT (mac) / DXGI→NVENC (win) / CUDA→NVENC (linux) addon inside the Electron
 *  worker only. Null when the artifact is absent, is a foreign build, or reports no usable
 *  encoder — all three are the same answer to the caller: no native encode here. */
/** Object-file format of a built addon, from its magic bytes. Used only to explain a load failure:
 *  a `.node` built on another OS is the single most likely reason this fails, and "cannot open
 *  shared object file" does not say so. */
export function addonPlatform(path: string): string | null {
  try {
    const fd = openSync(path, "r");
    const head = Buffer.alloc(4);
    readSync(fd, head, 0, 4, 0);
    closeSync(fd);
    const be = head.readUInt32BE(0);
    const le = head.readUInt32LE(0);
    if (be === 0x7f454c46) return "linux"; // \x7fELF
    if (be === 0xfeedface || be === 0xfeedfacf || le === 0xfeedface || le === 0xfeedfacf) return "darwin";
    if (be === 0xcafebabe || le === 0xcafebabe) return "darwin"; // universal binary
    if (head[0] === 0x4d && head[1] === 0x5a) return "win32"; // MZ
    return null;
  } catch {
    return null;
  }
}

/** Warn once when the addon exists but will not load. Silence here is expensive: `reconcileCapture`
 *  then degrades `auto` to `direct`, so the render succeeds at a fraction of the speed with no
 *  indication why. The committed artifact is built for whatever machine last ran `build:native`,
 *  so every other platform hits this. */
function warnAddonUnusable(path: string, reason: string): void {
  const built = addonPlatform(path);
  const mismatch = built && built !== process.platform ? ` It is a ${built} build, but this is ${process.platform}.` : "";
  process.stderr.write(
    `! gpu_capture.node present but unusable — hardware encode is OFF, falling back to a slower capture path.${mismatch}\n` +
      `  ${reason}\n  Fix: npm run build:native\n`,
  );
}

export function loadGpuCapture(): GpuCaptureNative | null {
  if (cached !== undefined) return cached;
  if (!nativeEncodeAvailable()) {
    cached = null;
    return null;
  }
  const path = nodePath();
  if (!path) {
    cached = null;
    return null;
  }
  try {
    const require = createRequire(import.meta.url);
    const mod = require(path) as GpuCaptureNative;
    cached = mod.available() ? mod : null;
    // available() === false is legitimate on a box with no GPU/driver — do not cry wolf there.
    return cached;
  } catch (err) {
    warnAddonUnusable(path, err instanceof Error ? err.message.split("\n")[0]! : String(err));
    cached = null;
    return null;
  }
}

/**
 * Resolve the concrete capture backend.
 * - `direct`: WebCodecs VideoFrame(canvas) → annex-B in-page. Bypasses OSR paint-wait; Chromium
 *   encodes on the GPU (VT under the hood on macOS). No gpu_capture module required.
 * - `shared`: OSR paint → IOSurface→VT (mac) / DXGI→NVENC (win). ~15ms paint-wait (CopyOutput).
 * - `readback`: WebGL readPixels → IPC → native encode. Usually slower than shared.
 * - `page`: capturePage JPEG (no native module).
 * - `auto`: `shared` when native exists on mac/win; `direct` on Linux (readback measured 2x slower
 *   than direct — see the comment in the `auto` branch below); `direct` otherwise too, when no
 *   native encode exists. Set `KINO_ELECTRON_CAPTURE=readback` to opt into Linux NVENC anyway, or
 *   `KINO_ELECTRON_CAPTURE=direct` for present-bypass.
 */
export function resolveElectronCapture(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  hasAddon: boolean = nodePath() != null,
  modeset: ModesetStatus = nvidiaDrmModeset(platform),
): CaptureKind {
  const mode = gpuCaptureMode(env);
  const gpu = nativeEncodeAvailable(platform, hasAddon);
  const linux = platform === "linux";

  if (mode === "page") return "page";
  if (mode === "direct") return "direct";

  if (mode === "shared") {
    if (linux) {
      // The real constraint chain (measured on real hardware, not inferred): Chromium's
      // GbmSupportX11 gets its DRM fd via DRI3; NVIDIA's X driver offers no DRI3 without
      // nvidia-drm.modeset=1, a host kernel module parameter no container can set. And even with
      // modeset=1, kino has no Linux shared-texture capture implementation yet — modeset is
      // necessary, not sufficient, so this must never read as "enable it and shared works".
      const modesetNote =
        modeset === "disabled"
          ? " On this host, nvidia-drm.modeset is currently disabled (N), so that prerequisite isn't even met yet."
          : "";
      throw new Error(
        "KINO_ELECTRON_CAPTURE=shared has no Linux shared-texture implementation yet. Even where it " +
          "existed, it would require Chromium to create a GBM device, which needs DRI3, which NVIDIA's " +
          "X driver only exposes when nvidia-drm.modeset=1 (a host kernel module parameter — not " +
          "settable from inside a container)." +
          modesetNote +
          " Use KINO_ELECTRON_CAPTURE=readback for hardware NVENC on Linux today, or leave it on auto " +
          "for the faster `direct` path.",
      );
    }
    if (!gpu) {
      throw new Error(
        "KINO_ELECTRON_CAPTURE=shared but kino gpu_capture native module is missing — run: npm run build:native",
      );
    }
    return "shared";
  }

  if (mode === "readback") {
    if (!gpu) {
      throw new Error(
        "KINO_ELECTRON_CAPTURE=readback but kino gpu_capture native module is missing — run: npm run build:native",
      );
    }
    return "readback";
  }

  // auto
  if (!gpu) return "direct";
  // Linux: `auto` yields `direct`, not `readback`, as of the RTX 3060 Ti benchmark below.
  // NVENC `readback` measured 2.0x SLOWER than software `direct` at every concurrency tested:
  //   c=1: readback 18.4fps vs direct 23.3fps
  //   c=4: readback 34.0fps vs direct 68.6fps
  //   c=8: readback 34.4fps vs direct 69.9fps
  // Concurrency widens the gap (direct 3.00x c1->c8, readback only 1.87x) — the encoder isn't the
  // bottleneck (NVENC encode is 16.16ms/frame and fully hidden by pipelining); the cost is
  // seek-readback at 95.33ms/frame, ~72ms of which is gl.readPixels plus an 8.3MB IPC push per
  // frame. That round trip out of VRAM and back is structural to the readback design, not a tuning
  // problem. This is interim, not a repudiation of the NVENC work: the zero-copy path (phase 2)
  // removes the round trip, but needs a host with nvidia-drm.modeset=1 and a GPU-backed display
  // path, unavailable in a stock container. Until phase 2 lands, `direct` is simply faster — and
  // it is now safe, since the Linux `direct` defect that once justified avoiding it is fixed (18/18
  // clean runs). Explicit `KINO_ELECTRON_CAPTURE=readback` still works (see the `mode === "readback"`
  // branch above) for anyone benchmarking NVENC. If you're reading this because `direct` is beating
  // a hardware encoder and that looks wrong: it isn't, re-run the benchmark before "fixing" it back.
  if (linux) return "direct";
  return "shared";
}

/**
 * Second-stage resolution, inside the Electron worker where the addon has actually been loaded.
 *
 * `resolveElectronCapture` can only see that the `.node` FILE exists (see `nativeEncodeAvailable`),
 * so it will happily resolve `shared`/`readback` against an addon that turns out to be a foreign
 * build, or a Linux one whose `available()` is false because the box has no NVIDIA driver. That
 * second case is not an edge: the Linux addon deliberately builds and loads driverless so the
 * fallback is exercisable, and hard-failing there would make a working CPU-only Linux render start
 * exiting 1 the moment a stale `gpu_capture.node` appeared in the tree.
 *
 * So an `auto` resolution degrades to `direct` — the same answer that box would have got with no
 * addon at all. An explicit `KINO_ELECTRON_CAPTURE` still throws: the user named a mode, and
 * silently rendering a different one is worse than failing.
 */
export function reconcileCapture(
  resolved: CaptureKind,
  gpuLoaded: boolean,
  env: NodeJS.ProcessEnv = process.env,
): CaptureKind {
  if (gpuLoaded) return resolved;
  if (resolved !== "shared" && resolved !== "readback") return resolved;
  if (gpuCaptureMode(env) !== "auto") {
    throw new Error(
      `KINO_ELECTRON_CAPTURE=${resolved} but the kino gpu_capture native module did not load ` +
        `(missing, built for another runtime, or available() is false — no GPU encoder on this box). ` +
        `Rebuild with: npm run build:native, or unset KINO_ELECTRON_CAPTURE to fall back to direct.`,
    );
  }
  return "direct";
}

/** True when the Electron worker will emit annex-B H.264 (not JPEG). */
export function useSharedTextureCapture(env: NodeJS.ProcessEnv = process.env): boolean {
  const resolved = resolveElectronCapture(env);
  return resolved === "shared" || resolved === "readback" || resolved === "direct";
}
