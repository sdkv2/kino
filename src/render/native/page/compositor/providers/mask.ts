// A file-backed mask: coverage frames plus the exact distance field written beside them.
// Both are ordinary /vframes stills, so this is the frames provider with a second channel.
import type { MediaEntry } from "../../media.js";
import { SDF_MAX_PX } from "../../../../sdf.js";
import { loadImage, uploadCanvasOrImage } from "./upload.js";

export interface MaskSourceHandle {
  prepare(frame: number): Promise<void>;
  coverage(gl: WebGL2RenderingContext, frame: number): WebGLTexture | null;
  sdf(gl: WebGL2RenderingContext, frame: number): WebGLTexture | null;
  /** 0 means no field for this frame — the mask shader falls back to raw coverage. */
  sdfMax(frame: number): number;
}

export function createMaskSource(entry: MediaEntry, fromFrame: number): MaskSourceHandle {
  const images = new Map<string, HTMLImageElement>();
  let covTex: WebGLTexture | null = null;
  let sdfTex: WebGLTexture | null = null;

  const urlFor = (frame: number, kind: "cov" | "sdf"): string | null => {
    const idx = Math.min(Math.max(0, frame - fromFrame), entry.maxFrame);
    const file = kind === "cov" ? entry.byFrame[idx] : entry.sdfByFrame?.[idx];
    return file ? `/vframes/${entry.dir}/${file}` : null;
  };

  return {
    async prepare(frame: number): Promise<void> {
      await Promise.all(
        (["cov", "sdf"] as const).map(async (kind) => {
          const url = urlFor(frame, kind);
          if (!url || images.has(url)) return;
          const img = await loadImage(url);
          if (img) images.set(url, img);
        }),
      );
    },
    coverage(gl, frame) {
      const url = urlFor(frame, "cov");
      const img = url ? images.get(url) : undefined;
      if (!img) return null;
      covTex = uploadCanvasOrImage(gl, covTex, img);
      return covTex;
    },
    sdf(gl, frame) {
      const url = urlFor(frame, "sdf");
      const img = url ? images.get(url) : undefined;
      if (!img) return null;
      sdfTex = uploadCanvasOrImage(gl, sdfTex, img);
      return sdfTex;
    },
    sdfMax(frame) {
      // Mirrors RegionShader: 0 signals "no field this frame", which the mask shader reads
      // as its cue to fall back to raw coverage rather than decoding garbage.
      return urlFor(frame, "sdf") ? SDF_MAX_PX : 0;
    },
  };
}
