export interface MotionPostEffect {
  test(html: string): boolean;
  apply(ctx: {
    /** Full FO raster (reference / non-lens effects). */
    base: HTMLCanvasElement;
    /** Scene minus lens trees — merged with compositor-under for mirror sampling. */
    sample?: HTMLCanvasElement;
    /** Per-frame layout manifest — placement + baked lens materials. */
    manifest?: import("../lensLayout.js").MotionLayoutManifest;
    plates?: import("../lensLayout.js").MotionPaintPlates;
    /** Live DOM host from prepare(); CPU fallback only. */
    lensHost?: import("../lensLayout.js").MotionLensHost;
    /** Lens descendant plate — composited above mirrors. */
    chrome?: HTMLCanvasElement;
    html: string;
    vars: Record<string, string>;
    width: number;
    height: number;
    theme: Theme;
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
