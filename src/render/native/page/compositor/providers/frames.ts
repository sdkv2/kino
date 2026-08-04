// Pre-extracted video stills. The node side wrote one image per composition-local frame
// (videoFrames.ts), so there is no <video> and no raster — just an upload.
import type { MediaEntry } from "../../media.js";
import type { TextureSource } from "../graph.js";
import { SDF_MAX_PX } from "../../../../sdf.js";
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

/**
 * Frames source for a FILE-KIND layer mask: serves BOTH the coverage frame (entry.byFrame) and
 * its signed-distance twin (entry.sdfByFrame) at the same local frame, so the mask pass can use
 * the exact-distance feather (masks.ts uMaskSdf branch) instead of the raw-coverage fallback.
 *
 * The two streams are prepared together (same prepare(), two URLs) so the seek path cannot
 * prepare the coverage and miss the SDF — a masked layer that rendered with a null field would
 * silently fall back to the coarse texture feather.
 */
export function createMaskFramesSource(entry: MediaEntry, fromFrame: number): TextureSource & {
  /** Distance-field texture for the CURRENT frame, or null when none was written. */
  sdfTexture: (gl: WebGL2RenderingContext) => WebGLTexture | null;
  /** SDF encode half-range in px (SDF_MAX_PX) when a field exists this frame; 0 otherwise. */
  sdfMax: number;
} {
  const decoded = new Map<string, HTMLImageElement>();
  const sdfDecoded = new Map<string, HTMLImageElement>();
  let tex: WebGLTexture | null = null;
  let sdfTex: WebGLTexture | null = null;
  let current: string | null = null;
  let currentSdf: string | null = null;
  let uploaded: string | null = null;
  let uploadedSdf: string | null = null;
  let sdfMax = 0;

  const sdfUrlFor = (entry: MediaEntry, local: number): string | null => {
    const idx = Math.min(Math.max(0, local), entry.maxFrame);
    const file = entry.sdfByFrame?.[idx];
    return file ? `/vframes/${entry.dir}/${file}` : null;
  };

  return {
    async prepare(frame: number): Promise<void> {
      const local = frame - fromFrame;
      current = frameUrlFor(entry, local);
      currentSdf = sdfUrlFor(entry, local);
      sdfMax = currentSdf ? SDF_MAX_PX : 0;
      if (current && !decoded.has(current)) {
        const img = await loadImage(current);
        if (img) decoded.set(current, img);
      }
      if (currentSdf && !sdfDecoded.has(currentSdf)) {
        const img = await loadImage(currentSdf);
        if (img) sdfDecoded.set(currentSdf, img);
      }
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
    sdfTexture(gl: WebGL2RenderingContext): WebGLTexture | null {
      if (!currentSdf) return null;
      const img = sdfDecoded.get(currentSdf);
      if (!img) return null;
      if (uploadedSdf === currentSdf && sdfTex) return sdfTex;
      sdfTex = uploadCanvasOrImage(gl, sdfTex, img);
      uploadedSdf = currentSdf;
      return sdfTex;
    },
    get sdfMax(): number {
      return sdfMax;
    },
    size(): { w: number; h: number } | null {
      const img = current ? decoded.get(current) : undefined;
      return img ? { w: img.naturalWidth, h: img.naturalHeight } : null;
    },
    dispose(): void {
      decoded.clear();
      sdfDecoded.clear();
    },
  };
}
