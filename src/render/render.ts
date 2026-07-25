// Render entry points — the in-house headless-Chrome frame engine (render/native) behind the same
// API the pipeline has always called.
import type { KinoProps } from "./props.js";
import { renderStillsNative, renderVideoNative } from "./native/engine.js";
import type { FrameMeasure } from "./native/engine.js";

export type { FrameMeasure, ElementMeasure } from "./native/engine.js";

// Output base name. A tag keeps variant renders (e.g. different backgrounds) side-by-side
// instead of overwriting the default.
export function variantName(title: string, tag?: string): string {
  return tag ? `${title}-${tag}` : title;
}

export interface RenderOpts {
  props: KinoProps;
  publicDir: string; // assets root the render page serves under /public/
  formats: Array<"9:16" | "3:4" | "16:9">;
  outDir: string;
  title: string;
  /** x264 preset: "veryfast" for mock/preview builds (2-3x faster encode, ~15% larger files at the
   *  same crf), "medium" (default) for finals. */
  preset?: "medium" | "veryfast";
}

export interface StillsOpts {
  props: KinoProps;
  publicDir: string;
  format: "9:16" | "3:4" | "16:9";
  frames: Array<{ frame: number; name: string }>;
  outDir: string;
  measureSink?: FrameMeasure[]; // if provided, element geometry is collected into it per frame
}

// Render individual PNG stills (one page, many frames) — fast preview, no video encode.
export async function renderStills(opts: StillsOpts): Promise<string[]> {
  return renderStillsNative(opts);
}

export async function renderVideo(opts: RenderOpts): Promise<string[]> {
  return renderVideoNative(opts);
}
