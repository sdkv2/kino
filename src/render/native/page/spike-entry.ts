// SPIKE ONLY — never shipped. Exposes the raster path on window so a puppeteer
// benchmark can time buildTemplate/rasterAt directly.
import { buildTemplate, rasterAt, scrubCss } from "./bgTextures";
import type { KinoProps } from "../props.js";

declare global {
  interface Window {
    __spike: {
      buildTemplate: typeof buildTemplate;
      rasterAt: typeof rasterAt;
      scrubCss: typeof scrubCss;
    };
  }
}

window.__spike = { buildTemplate, rasterAt, scrubCss };
