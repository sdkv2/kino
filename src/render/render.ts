import { bundle, type WebpackOverrideFn } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import type { KinoProps } from "./props.js";

const here = dirname(fileURLToPath(import.meta.url));
// Source .tsx entry (excluded from tsc build; bundled by esbuild at render time).
// src/render and dist/render are both two levels under the package root.
const ENTRY = resolve(here, "../../src/render/remotion/index.tsx");

// Remotion bundles the .tsx SOURCE with webpack, whose resolver — unlike node ESM + tsc — does NOT map
// a ".js" specifier onto its ".ts" source. Alias it so a module shared by the CLI (node ESM, which
// requires the ".js" extension) and the composition bundle can use one ".js" import form. Without this,
// a dual-consumed file (e.g. motionVars, imported by build.ts AND MotionGraphic.tsx) can't import
// bgparams.js and resolve in both places.
const tsResolve: WebpackOverrideFn = (config) => ({
  ...config,
  resolve: {
    ...config.resolve,
    extensionAlias: { ...(config.resolve?.extensionAlias ?? {}), ".js": [".ts", ".tsx", ".js"] },
  },
});

const DIMS: Record<string, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "3:4": { width: 1080, height: 1440 },
};

// Output base name. A tag keeps variant renders (e.g. different backgrounds) side-by-side
// instead of overwriting the default.
export function variantName(title: string, tag?: string): string {
  return tag ? `${title}-${tag}` : title;
}

// bundle() writes a fresh webpack bundle (~17MB) to an OS temp dir on every render and never cleans
// it up — hundreds of renders fill the disk (ENOSPC). Remove it after each render. Guarded on the
// remotion bundle name so an unexpected serveUrl is never deleted.
export function cleanupServeUrl(serveUrl: string): void {
  if (!serveUrl || !/remotion-webpack-bundle/.test(serveUrl)) return;
  rmSync(serveUrl, { recursive: true, force: true });
}

export interface RenderOpts {
  props: KinoProps;
  publicDir: string; // assets root Remotion staticFile() reads from
  formats: Array<"9:16" | "3:4">;
  outDir: string;
  title: string;
}

export interface StillsOpts {
  props: KinoProps;
  publicDir: string;
  format: "9:16" | "3:4";
  frames: Array<{ frame: number; name: string }>;
  outDir: string;
}

// Render individual PNG stills (one bundle, many frames) — fast preview, no video encode.
export async function renderStills({ props, publicDir, format, frames, outDir }: StillsOpts): Promise<string[]> {
  mkdirSync(outDir, { recursive: true });
  const serveUrl = await bundle({ entryPoint: ENTRY, publicDir, webpackOverride: tsResolve });
  try {
    const inputProps = props as unknown as Record<string, unknown>;
    const { width, height } = DIMS[format];
    const comp = await selectComposition({ serveUrl, id: "KinoVideo", inputProps });
    const maxFrame = comp.durationInFrames - 1;
    const outs: string[] = [];
    for (const { frame, name } of frames) {
      const out = join(outDir, `${name}.png`);
      await renderStill({
        composition: { ...comp, width, height },
        serveUrl,
        output: out,
        frame: Math.min(maxFrame, Math.max(0, frame)),
        inputProps,
      });
      outs.push(out);
    }
    return outs;
  } finally {
    cleanupServeUrl(serveUrl);
  }
}

export async function renderVideo({ props, publicDir, formats, outDir, title }: RenderOpts): Promise<string[]> {
  mkdirSync(outDir, { recursive: true });
  const serveUrl = await bundle({ entryPoint: ENTRY, publicDir, webpackOverride: tsResolve });
  try {
    const inputProps = props as unknown as Record<string, unknown>;
    const outputs: string[] = [];
    for (const fmt of formats) {
      const { width, height } = DIMS[fmt];
      const comp = await selectComposition({ serveUrl, id: "KinoVideo", inputProps });
      const out = join(outDir, `${title}-${fmt.replace(":", "x")}.mp4`);
      await renderMedia({
        composition: { ...comp, width, height },
        serveUrl,
        codec: "h264",
        inputProps,
        outputLocation: out,
      });
      outputs.push(out);
    }
    return outputs;
  } finally {
    cleanupServeUrl(serveUrl);
  }
}
