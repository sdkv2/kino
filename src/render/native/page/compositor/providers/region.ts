// Mask-split region shaders. Like the shader provider, the program, mask uploads and SDF
// channel binding are unchanged from RegionShader.tsx — only the destination differs: it
// renders into an offscreen canvas the compositor samples, instead of its own visible one.
//
// RegionShader.tsx is NOT edited. It remains the DOM path's implementation and the parity
// reference; this file copies what it needs.
import type { RegionShaderProps } from "../../../../props.js";
import type { TextureSource } from "../graph.js";
import { uploadCanvasOrImage } from "./upload.js";

export function createRegionSource(opts: {
  region: RegionShaderProps;
  /** Renders this frame into `canvas` — the program, uniforms, mask textures and SDF
   *  channels lifted from RegionShader.tsx. Built by Stage.tsx, which owns compilation. */
  drawFrame: (canvas: HTMLCanvasElement, frame: number) => void | Promise<void>;
  width: number;
  height: number;
}): TextureSource {
  const canvas = document.createElement("canvas");
  canvas.width = opts.width;
  canvas.height = opts.height;
  let tex: WebGLTexture | null = null;

  return {
    async prepare(frame: number): Promise<void> {
      await opts.drawFrame(canvas, frame);
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
