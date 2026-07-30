// The ANGLE backend choice, in its own module for the same reason sandbox.ts is: electron/app.ts
// loads inside the Electron main process, so anything it needs must be free of parent-side imports.
// Two copies of this ternary would drift, and the rationale below is expensive to re-derive.

/** ANGLE backend per platform. A valueless `--use-angle` is a no-op: Chrome needs an explicit
 *  backend, and headless Linux then silently falls back to SwiftShader (~9.6x slower). Probed on
 *  an RTX 2070 SUPER: `vulkan` is the only value that binds the NVIDIA GPU headless — `gl` reports
 *  SwiftShader because the EGL/GL backend needs a display. d3d11 is Chrome's own Windows default,
 *  and metal is the right macOS pick (without it Electron can fall to a slower path).
 *
 *  KINO_GPU=0 overrides all of that and forces `swiftshader` (a real ANGLE backend value, not the
 *  Linux no-flag fallback above) regardless of platform. Needed because those hardware backends
 *  assume a real GPU is present: on a GPU-less box — GitHub Actions' `ubuntu-latest` runners have
 *  none — forcing `vulkan` makes ANGLE fail Vulkan instance init ("Extension not supported:
 *  VK_KHR_surface") and Chromium exits the GPU process, which then hangs the render page's boot
 *  forever (native/electron/offscreenWindow.ts's awaitBoot times out at 60s) instead of falling
 *  back to software. */
export function angleBackend(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (env.KINO_GPU === "0") return "swiftshader";
  if (platform === "darwin") return "metal";
  if (platform === "win32") return "d3d11";
  return "vulkan";
}
