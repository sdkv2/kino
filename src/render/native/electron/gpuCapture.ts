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
      // Two things here are settled by measurement, and the second one is why implementing this
      // would currently be wasted work.
      //
      // 1. The prerequisites ARE obtainable, contrary to an earlier reading of this code. With
      //    nvidia-drm.modeset=Y on the host (rented containers do sometimes have it), a real Xorg
      //    on the NVIDIA X driver, and `--enable-features=Vulkan`, Electron OSR delivers a texture
      //    on every paint: a single-plane BGRA dma-buf, modifier 0 (linear), which NVIDIA's own
      //    Vulkan will import as a renderable color attachment, and which imports into CUDA via
      //    EGL in ~0.6ms with a ~0.03ms/frame device copy. None of that is the blocker.
      // 2. The delivered buffer is never written. Every byte reads zero — verified through three
      //    independent views of the same fd (CPU mmap, CUDA, GLES) on drivers 575, 580 and 595,
      //    with Chromium logging nothing at all. A CUDA write to that same mapping IS visible
      //    through mmap, so the aliasing is real and the tooling is sound; Chromium's composited
      //    frame simply never lands in the buffer it handed us. Consistent with its own note in
      //    renderable_gpu_memory_buffer_video_frame_pool.cc: NVIDIA's GBM cannot allocate
      //    LINEAR|RENDERING, so the copy that would fill this buffer has nowhere to go.
      //
      // So this is upstream-blocked (electron#49247), not merely unimplemented. Anyone reviving it
      // should content-verify a delivered texture FIRST — a non-null `details.texture` proves
      // nothing — and treat "works on distro X" reports as delivery-only until pixels are checked.
      const modesetNote =
        modeset === "disabled"
          ? " On this host, nvidia-drm.modeset is currently disabled (N), which is one of the prerequisites."
          : "";
      throw new Error(
        "KINO_ELECTRON_CAPTURE=shared has no Linux shared-texture implementation, and implementing " +
          "one would not help today: Chromium delivers an OSR shared texture on NVIDIA whose buffer " +
          "it never writes (measured silently empty on drivers 575/580/595 — electron#49247)." +
          modesetNote +
          " Use KINO_ELECTRON_CAPTURE=readback to reach NVENC on Linux, or leave it on auto for the " +
          "much faster `direct` path.",
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
  // Linux: `auto` yields `direct`, not `readback`. Re-measured on an RTX 3060 (KVM VM, driver
  // 580.82.09, NVENC confirmed live on that box by a distro `ffmpeg -c:v h264_nvenc` smoke) with
  // the PBO transport that actually ships — so unlike the original sync-readPixels sweep, these
  // numbers describe the code in this repo. Software `direct` wins at every concurrency, and by a
  // wider margin than before:
  //   c=2: readback 11.6fps vs direct 29.6fps
  //   c=4: readback 16.8fps vs direct 69.8fps
  //   c=6: readback 20.9fps vs direct 84.4fps
  //   c=8: readback 23.0fps vs direct 85.3fps
  // The PBO transport is worth ~0 on NVIDIA: `KINO_RB_SYNC=1` measured 18.6fps at c=4 against the
  // PBO path's 16.8, so the 34.6→23.5ms transport win it bought on an M4 does not transfer here.
  // The offload is real but does not help — readback peaks at 3.7 cores of CPU against direct's
  // 11, i.e. the encode genuinely moves onto the ASIC and the GPU→CPU transport starves the
  // pipeline anyway. That round trip out of VRAM and back is structural to the readback design,
  // not a tuning problem, and the zero-copy path that would have removed it is upstream-blocked:
  // Chromium hands Electron OSR a shared texture on NVIDIA whose buffer it never writes, silently,
  // on drivers 575/580/595 alike (electron#49247). Explicit `KINO_ELECTRON_CAPTURE=readback` still
  // works (see the `mode === "readback"` branch above) for anyone benchmarking NVENC. If you're
  // reading this because `direct` is beating a hardware encoder and that looks wrong: it isn't —
  // both halves of that comparison have now been measured on real NVIDIA hardware with the
  // shipping transport, so re-run the sweep before "fixing" it back.
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
