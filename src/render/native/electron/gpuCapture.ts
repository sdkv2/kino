import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export interface GpuCaptureNative {
  available(): boolean;
  initEncoder(width: number, height: number, fps: number): void;
  encodeSharedTexture(
    handle: Buffer,
    width: number,
    height: number,
    pixelFormat: "bgra" | "rgba" | "rgbaf16" | "nv12",
    outWidth?: number,
    outHeight?: number,
  ): Buffer;
  encodeBitmap(
    bgra: Buffer,
    width: number,
    height: number,
    outWidth?: number,
    outHeight?: number,
  ): Buffer;
  shutdownEncoder(): void;
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

export function gpuCaptureMode(env: NodeJS.ProcessEnv = process.env): "shared" | "page" | "auto" {
  const v = env.KINO_ELECTRON_CAPTURE;
  if (v === "shared" || v === "page") return v;
  return "auto";
}

/** True when the native addon artifact exists (parent Node must not dlopen — Electron ABI). */
export function sharedTextureCaptureAvailable(): boolean {
  return process.platform === "darwin" && nodePath() != null;
}

/** Load IOSurface → VideoToolbox addon inside the Electron worker only. */
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

export function useSharedTextureCapture(env: NodeJS.ProcessEnv = process.env): boolean {
  const mode = gpuCaptureMode(env);
  if (mode === "page") return false;
  if (mode === "shared") {
    if (!sharedTextureCaptureAvailable()) {
      throw new Error(
        "KINO_ELECTRON_CAPTURE=shared but kino gpu_capture native module is missing — run: npm run build:native",
      );
    }
    return true;
  }
  return sharedTextureCaptureAvailable();
}
