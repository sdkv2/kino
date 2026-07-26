// Compositor-side region shader host — reuses RegionShader's GL draw path without React.
import type { RegionShaderProps, Theme } from "../../../props.js";
import type { MediaMap } from "../media.js";
import { staticFile } from "../runtime.js";
import { drawFrame, type RegionSrc } from "../RegionShader.js";
import { createRegionSource } from "./providers/region.js";
import { frameUrlFor } from "./providers/frames.js";
import type { MediaEntry } from "../media.js";

function sdfUrlFor(entry: MediaEntry, local: number): string | null {
  const idx = Math.min(Math.max(0, local), entry.maxFrame);
  const file = entry.sdfByFrame?.[idx];
  return file ? `/vframes/${entry.dir}/${file}` : null;
}

export function createRegionCompositorSource(opts: {
  region: RegionShaderProps;
  theme: Theme;
  width: number;
  height: number;
  fps: number;
  beatFrom: number;
  beatDur: number;
  assetRel: string;
  assetMediaKey?: string;
  maskMediaKeys: (string | undefined)[];
  backdropMediaKey?: string;
  media: MediaMap;
}) {
  const initRef: { current: Promise<unknown> | null } = { current: null };
  return createRegionSource({
    region: opts.region,
    width: opts.width,
    height: opts.height,
    drawFrame: async (canvas, frame) => {
      const local = frame - opts.beatFrom;
      const assetEntry = opts.assetMediaKey ? opts.media[opts.assetMediaKey] : undefined;
      const assetSrc: RegionSrc = {
        frameVideo: Boolean(opts.assetMediaKey),
        staticUrl: staticFile(opts.assetRel),
        frameUrl: assetEntry ? frameUrlFor(assetEntry, local) : null,
      };
      const maskSrcs: RegionSrc[] = opts.region.masks.map((m, i) => {
        const key = opts.maskMediaKeys[i];
        const entry = key ? opts.media[key] : undefined;
        return {
          frameVideo: m.maskKind === "video",
          staticUrl: staticFile(m.maskSrc),
          frameUrl: entry ? frameUrlFor(entry, local) : null,
        };
      });
      const sdfSrcs: (RegionSrc | null)[] = opts.region.masks.map((m, i) => {
        const key = opts.maskMediaKeys[i];
        const entry = key ? opts.media[key] : undefined;
        return m.maskKind === "video" && entry
          ? { frameVideo: true, staticUrl: "", frameUrl: sdfUrlFor(entry, local) }
          : null;
      });
      const backdropSrc: RegionSrc | null = opts.region.backdrop
        ? {
            frameVideo: Boolean(opts.backdropMediaKey),
            staticUrl: staticFile(opts.region.backdrop),
            frameUrl: opts.backdropMediaKey && opts.media[opts.backdropMediaKey]
              ? frameUrlFor(opts.media[opts.backdropMediaKey], local)
              : null,
          }
        : null;
      await drawFrame(
        canvas,
        initRef as { current: Promise<import("../RegionShader.js").RegionGLState | null> | null },
        assetSrc,
        maskSrcs,
        sdfSrcs,
        opts.region,
        local,
        opts.width,
        opts.height,
        opts.fps,
        opts.theme,
        opts.beatDur,
        backdropSrc,
      );
    },
  });
}
