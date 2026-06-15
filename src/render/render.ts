import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import type { KinoProps } from "./props.js";

const here = dirname(fileURLToPath(import.meta.url));
// Source .tsx entry (excluded from tsc build; bundled by esbuild at render time).
// src/render and dist/render are both two levels under the package root.
const ENTRY = resolve(here, "../../src/render/remotion/index.tsx");

const DIMS: Record<string, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "3:4": { width: 1080, height: 1440 },
};

// Output base name. A tag keeps variant renders (e.g. different backgrounds) side-by-side
// instead of overwriting the default.
export function variantName(title: string, tag?: string): string {
  return tag ? `${title}-${tag}` : title;
}

export interface RenderOpts {
  props: KinoProps;
  publicDir: string; // assets root Remotion staticFile() reads from
  formats: Array<"9:16" | "3:4">;
  outDir: string;
  title: string;
}

export async function renderVideo({ props, publicDir, formats, outDir, title }: RenderOpts): Promise<string[]> {
  mkdirSync(outDir, { recursive: true });
  const serveUrl = await bundle({ entryPoint: ENTRY, publicDir });
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
}
