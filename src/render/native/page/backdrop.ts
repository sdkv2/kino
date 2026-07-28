// Frame backdrop bus: layers publish what's beneath so motion post-effects (glass, …) can sample it.
// Compositor readback feeds the canvas path; per-layer providers call registerBackdrop after draw.

export interface Backdrop {
  source: CanvasImageSource;
  width: number;
  height: number;
}

export interface BackdropTexture {
  tex: WebGLTexture;
  width: number;
  height: number;
}

let backdrop: Backdrop | null = null;
let backdropTexture: BackdropTexture | null = null;

/** Called by background layers each frame after they draw. Idempotent. */
export function registerBackdrop(source: CanvasImageSource, width: number, height: number): void {
  backdropTexture = null;
  backdrop = { source, width, height };
}

/** Compositor entry point: true composite beneath a layer, already on the GPU. */
export function registerBackdropTexture(tex: WebGLTexture, width: number, height: number): void {
  backdrop = null;
  backdropTexture = { tex, width, height };
}

export function clearBackdrop(): void {
  backdropTexture = null;
  backdrop = null;
}

/** Read-only peek before a post-effect overwrites the bus. */
export function peekBackdrop(): Readonly<Backdrop> | null {
  return backdrop;
}

export function peekBackdropTexture(): Readonly<BackdropTexture> | null {
  return backdropTexture;
}

/** Merge compositor-under + an in-beat raster — stacked panels sample this. */
export function registerMergedBackdrop(
  raster: HTMLCanvasElement,
  under: Readonly<Backdrop> | null = backdrop,
): void {
  const merged = document.createElement("canvas");
  merged.width = raster.width;
  merged.height = raster.height;
  const mc = merged.getContext("2d");
  if (!mc) return;
  if (under) mc.drawImage(under.source, 0, 0, merged.width, merged.height);
  mc.drawImage(raster, 0, 0);
  registerBackdrop(merged, merged.width, merged.height);
}
