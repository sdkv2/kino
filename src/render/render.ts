// Render entry points — the in-house headless-Chrome frame engine (render/native) behind the same
// API the pipeline has always called.
import type { KinoProps } from "./props.js";
import { hydratePropsLensShaders } from "../media/effectsLib.js";
import { renderStillsNative, renderVideoNative } from "./native/engine.js";
import type { FrameMeasure, QualityPreset } from "./native/engine.js";
import type { FormatId } from "./formats.js";

export type { FrameMeasure, ElementMeasure, QualityPreset } from "./native/engine.js";
export type { FormatId } from "./formats.js";

// Output base name. A tag keeps variant renders (e.g. different backgrounds) side-by-side
// instead of overwriting the default.
export function variantName(title: string, tag?: string): string {
  return tag ? `${title}-${tag}` : title;
}

export interface RenderOpts {
  props: KinoProps;
  publicDir: string; // assets root the render page serves under /public/
  formats: FormatId[];
  outDir: string;
  title: string;
  /** x264 preset: "veryfast" for mock/preview builds (2-3x faster encode, ~15% larger files at the
   *  same crf), "medium" (default) for finals. */
  preset?: "medium" | "veryfast";
  /** Supersampling is opt-in: "very-high" renders the composite at 2×. Default "standard" (1×). */
  quality?: QualityPreset;
}

export interface StillsOpts {
  props: KinoProps;
  publicDir: string;
  format: FormatId;
  frames: Array<{ frame: number; name: string }>;
  outDir: string;
  measureSink?: FrameMeasure[]; // if provided, element geometry is collected into it per frame
  /** Supersampling is opt-in: "very-high" renders the composite at 2×. Default "standard" (1×). */
  quality?: QualityPreset;
}

// Render individual PNG stills (one page, many frames) — fast preview, no video encode.
export async function renderStills(opts: StillsOpts): Promise<string[]> {
  return renderStillsNative({ ...opts, props: hydratePropsLensShaders(opts.props) });
}

export async function renderVideo(opts: RenderOpts): Promise<string[]> {
  return renderVideoNative({ ...opts, props: hydratePropsLensShaders(opts.props) });
}
