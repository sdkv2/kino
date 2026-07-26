export interface MotionPostEffect {
  test(html: string): boolean;
  apply(ctx: {
    base: HTMLCanvasElement;
    html: string;
    vars: Record<string, string>;
    width: number;
    height: number;
    gl?: WebGL2RenderingContext;
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
