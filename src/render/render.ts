// Render entry points — the in-house headless-Chrome frame engine (render/native) behind the same
// API the pipeline has always called.
import { join } from "node:path";
import type { Format } from "../spec/schema.js";
import type { KinoProps } from "./props.js";
import { renderStillsNative, renderVideoNative } from "./native/engine.js";

// Output base name. A tag keeps variant renders (e.g. different backgrounds) side-by-side
// instead of overwriting the default.
export function variantName(title: string, tag?: string): string {
  return tag ? `${title}-${tag}` : title;
}

export interface RenderOpts {
  props: KinoProps;
  publicDir: string; // assets root the render page serves under /public/
  /** Blender-rendered 3D stills root (served under /scene3d/). Defaults beside publicDir. */
  scene3dDir?: string;
  formats: Format[];
  outDir: string;
  title: string;
  /** x264 preset: "veryfast" for mock/preview builds (2-3x faster encode, ~15% larger files at the
   *  same crf), "medium" (default) for finals. */
  preset?: "medium" | "veryfast";
}

export interface StillsOpts {
  props: KinoProps;
  publicDir: string;
  scene3dDir?: string;
  format: Format;
  frames: Array<{ frame: number; name: string }>;
  outDir: string;
}

function withScene3d<T extends { publicDir: string; scene3dDir?: string }>(opts: T): T & { scene3dDir: string } {
  return { ...opts, scene3dDir: opts.scene3dDir ?? join(opts.publicDir, "..", "_scene3d") };
}

// Render individual PNG stills (one page, many frames) — fast preview, no video encode.
export async function renderStills(opts: StillsOpts): Promise<string[]> {
  return renderStillsNative(withScene3d(opts));
}

export async function renderVideo(opts: RenderOpts): Promise<string[]> {
  return renderVideoNative(withScene3d(opts));
}
