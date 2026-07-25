// XMLSerializer emits a <canvas> element, never its pixels — so any canvas inside markup
// bound for a foreignObject raster would render empty, silently. The Lottie player draws
// into exactly such a canvas.
//
// Nested canvases are therefore found in the staging DOM, hidden from the raster, and drawn
// as their own layers positioned by their measured rect.
import type { TextureSource } from "../graph.js";
import { uploadCanvasOrImage } from "./upload.js";

export interface NestedCanvas {
  canvas: HTMLCanvasElement;
  rect: DOMRect;
}

/** Every <canvas> in the subtree, with its position relative to the subtree root. */
export function findNestedCanvases(root: ParentNode): NestedCanvas[] {
  const host = root as unknown as Element;
  const origin = typeof host.getBoundingClientRect === "function"
    ? host.getBoundingClientRect()
    : new DOMRect(0, 0, 0, 0);
  return Array.from(root.querySelectorAll("canvas")).map((canvas) => {
    const r = canvas.getBoundingClientRect();
    return {
      canvas: canvas as HTMLCanvasElement,
      rect: new DOMRect(r.x - origin.x, r.y - origin.y, r.width, r.height),
    };
  });
}

/** Hide lifted canvases from the raster so they are not drawn twice — once empty in the
 *  raster, once for real as their own layer. */
export function hideFromRaster(nested: NestedCanvas[]): void {
  for (const { canvas } of nested) canvas.style.visibility = "hidden";
}

export function createNestedCanvasSource(canvas: HTMLCanvasElement): TextureSource {
  let tex: WebGLTexture | null = null;
  return {
    async prepare(): Promise<void> {
      // The canvas is drawn into by its own player during the staging commit; nothing to await.
    },
    texture(gl: WebGL2RenderingContext): WebGLTexture | null {
      if (!canvas.width || !canvas.height) return null;
      tex = uploadCanvasOrImage(gl, tex, canvas);
      return tex;
    },
    size(): { w: number; h: number } {
      return { w: canvas.width, h: canvas.height };
    },
  };
}
