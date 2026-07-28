// The ANGLE backend choice, in its own module for the same reason sandbox.ts is: electron/app.ts
// loads inside the Electron main process, so anything it needs must be free of parent-side imports.
// Two copies of this ternary would drift, and the rationale below is expensive to re-derive.

/** ANGLE backend per platform. A valueless `--use-angle` is a no-op: Chrome needs an explicit
 *  backend, and headless Linux then silently falls back to SwiftShader (~9.6x slower). Probed on
 *  an RTX 2070 SUPER: `vulkan` is the only value that binds the NVIDIA GPU headless — `gl` reports
 *  SwiftShader because the EGL/GL backend needs a display. d3d11 is Chrome's own Windows default,
 *  and metal is the right macOS pick (without it Electron can fall to a slower path). */
export function angleBackend(platform: NodeJS.Platform = process.platform): string {
  if (platform === "darwin") return "metal";
  if (platform === "win32") return "d3d11";
  return "vulkan";
}
