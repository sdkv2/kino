// WebGL2 shader backgrounds. The program, uniform resolution and texture channels are
// unchanged from ShaderBackground; only the destination differs — it renders into its own
// offscreen canvas, which the compositor then samples as a texture.
//
// The SS/FXAA resolve stays here in phase 1 so shader output is byte-identical to today's;
// moving it to the composite is phase 4 work and would change pixels.
import type { BgKeyframe, BgParamValue, BgTrigger } from "../../../../props.js";
import { registerBackdrop } from "../../backdrop.js";
import type { TextureSource } from "../graph.js";
import { uploadCanvasOrImage } from "./upload.js";

export function createShaderSource(opts: {
  /** Draws this frame into `canvas`. Supplied by the Stage, which owns the compiled program
   *  and the existing SS/FXAA plumbing from ShaderBackground. */
  drawFrame: (canvas: HTMLCanvasElement, frame: number) => void;
  width: number;
  height: number;
  params: Record<string, BgParamValue>;
  keyframes: BgKeyframe[];
  triggers: BgTrigger[];
}): TextureSource {
  const canvas = document.createElement("canvas");
  canvas.width = opts.width;
  canvas.height = opts.height;
  let tex: WebGLTexture | null = null;

  return {
    async prepare(frame: number): Promise<void> {
      opts.drawFrame(canvas, frame);
      registerBackdrop(canvas, opts.width, opts.height);
    },
    texture(gl: WebGL2RenderingContext): WebGLTexture | null {
      tex = uploadCanvasOrImage(gl, tex, canvas);
      return tex;
    },
    size(): { w: number; h: number } {
      return { w: opts.width, h: opts.height };
    },
  };
}
