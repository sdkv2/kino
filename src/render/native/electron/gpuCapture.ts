import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export type ElectronCaptureMode = "shared" | "readback" | "direct" | "page" | "auto";

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
}

let cached: GpuCaptureNative | null | undefined;
let resolvedPath: string | null | undefined;

function nodePath(): string | null {
  if (resolvedPath !== undefined) return resolvedPath;
  let dir = here;
  for (let i = 0; i < 8; i++) {
    const candidates = [
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

/** True when the native addon artifact exists (parent Node must not dlopen — Electron ABI). */
export function sharedTextureCaptureAvailable(): boolean {
  return process.platform === "darwin" && nodePath() != null;
}

/** Load IOSurface/RGBA → VideoToolbox addon inside the Electron worker only. */
export function loadGpuCapture(): GpuCaptureNative | null {
  if (cached !== undefined) return cached;
  if (!sharedTextureCaptureAvailable()) {
    cached = null;
    return null;
  }
  try {
    const path = nodePath();
    if (!path) {
      cached = null;
      return null;
    }
    const require = createRequire(import.meta.url);
    const mod = require(path) as GpuCaptureNative;
    cached = mod.available() ? mod : null;
    return cached;
  } catch {
    cached = null;
    return null;
  }
}

/**
 * Resolve the concrete capture backend.
 * - `direct`: WebCodecs VideoFrame(canvas) → annex-B in-page. Bypasses OSR paint-wait; Chromium
 *   encodes on the GPU (VT under the hood on macOS). No gpu_capture module required.
 * - `shared`: OSR paint → IOSurface → VT. Zero-copy present, but ~15ms paint-wait per frame.
 * - `readback`: WebGL readPixels → IPC → VT. Usually slower than shared (full RGBA copy).
 * - `page`: capturePage JPEG (no native module).
 * - `auto`: currently `shared` (proven). Set `KINO_ELECTRON_CAPTURE=direct` for present-bypass.
 */
export function resolveElectronCapture(
  env: NodeJS.ProcessEnv = process.env,
): "shared" | "readback" | "direct" | "page" {
  const mode = gpuCaptureMode(env);
  const gpu = sharedTextureCaptureAvailable();
  if (mode === "page") return "page";
  if (mode === "direct") return "direct";
  if (mode === "shared") {
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
  // auto — IOSurface shared until direct wins a head-to-head on this machine.
  if (gpu) return "shared";
  return "direct";
}

/** True when the Electron worker will emit annex-B H.264 (not JPEG). */
export function useSharedTextureCapture(env: NodeJS.ProcessEnv = process.env): boolean {
  const resolved = resolveElectronCapture(env);
  return resolved === "shared" || resolved === "readback" || resolved === "direct";
}
