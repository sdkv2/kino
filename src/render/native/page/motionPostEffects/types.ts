export interface MotionPostEffect {
  test(html: string): boolean;
  apply(ctx: {
    /** Full FO raster (reference / non-lens effects). */
    base: HTMLCanvasElement;
    /** Lens shell plate — mirror samples this (+ compositor-under). */
    field?: HTMLCanvasElement;
    /** Lens descendant plate — composited above mirrors. */
    chrome?: HTMLCanvasElement;
    html: string;
    vars: Record<string, string>;
    width: number;
    height: number;
    gl?: WebGL2RenderingContext;
    lensShaders?: Record<string, string>;
  }): MotionPostResult;
}

export interface GpuMotionPostResult {
  kind: "gpu";
  tex: WebGLTexture;
  w: number;
  h: number;
}

export type MotionPostResult = HTMLCanvasElement | GpuMotionPostResult;

export function isGpuMotionPostResult(result: MotionPostResult): result is GpuMotionPostResult {
  return typeof result === "object" && result !== null && "kind" in result && result.kind === "gpu";
}
