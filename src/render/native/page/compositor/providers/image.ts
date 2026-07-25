// A static image — logo, chrome frame, background image. Decoded once, uploaded once.
import type { TextureSource } from "../graph.js";
import { loadImage, uploadCanvasOrImage } from "./upload.js";

export function createImageSource(url: string): TextureSource {
  let img: HTMLImageElement | null = null;
  let tex: WebGLTexture | null = null;
  let loaded = false;

  return {
    async prepare(): Promise<void> {
      if (loaded) return;
      loaded = true;
      img = await loadImage(url);
    },
    texture(gl: WebGL2RenderingContext): WebGLTexture | null {
      if (!img) return null;
      if (!tex) tex = uploadCanvasOrImage(gl, null, img);
      return tex;
    },
    size(): { w: number; h: number } | null {
      return img ? { w: img.naturalWidth, h: img.naturalHeight } : null;
    },
  };
}
