import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdirSync } from "node:fs";
const here = dirname(fileURLToPath(import.meta.url));
// Source .tsx entry (excluded from tsc build; bundled by esbuild at render time).
// src/render and dist/render are both two levels under the package root.
const ENTRY = resolve(here, "../../src/render/remotion/index.tsx");
const DIMS = {
    "9:16": { width: 1080, height: 1920 },
    "3:4": { width: 1080, height: 1440 },
};
export async function renderVideo({ props, publicDir, formats, outDir, title }) {
    mkdirSync(outDir, { recursive: true });
    const serveUrl = await bundle({ entryPoint: ENTRY, publicDir });
    const inputProps = props;
    const outputs = [];
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
