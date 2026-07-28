// Pre-extracted video stills. The node side wrote one image per composition-local frame
// (videoFrames.ts), so there is no <video> and no raster — just an upload.
import type { MediaEntry } from "../../media.js";
import type { TextureSource } from "../graph.js";
import { loadImage, uploadCanvasOrImage } from "./upload.js";

/** The /vframes URL for a local frame, clamped at both ends. Null on a sparse gap. */
export function frameUrlFor(entry: MediaEntry, local: number): string | null {
  const idx = Math.min(Math.max(0, local), entry.maxFrame);
  const file = entry.byFrame[idx];
  return file ? `/vframes/${entry.dir}/${file}` : null;
}

export function createFramesSource(entry: MediaEntry, fromFrame: number): TextureSource {
  const decoded = new Map<string, HTMLImageElement>();
  let tex: WebGLTexture | null = null;
  let current: string | null = null;
  let uploaded: string | null = null;

  return {
    async prepare(frame: number): Promise<void> {
      const url = frameUrlFor(entry, frame - fromFrame);
      current = url;
      if (!url || decoded.has(url)) return;
      const img = await loadImage(url);
      if (img) decoded.set(url, img);
    },
    texture(gl: WebGL2RenderingContext): WebGLTexture | null {
      if (!current) return null;
      const img = decoded.get(current);
      if (!img) return null;
      if (uploaded === current && tex) return tex;
      tex = uploadCanvasOrImage(gl, tex, img);
      uploaded = current;
      return tex;
    },
    size(): { w: number; h: number } | null {
      const img = current ? decoded.get(current) : undefined;
      return img ? { w: img.naturalWidth, h: img.naturalHeight } : null;
    },
    dispose(): void {
      decoded.clear();
    },
  };
}
