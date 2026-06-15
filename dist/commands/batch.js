import { readFileSync } from "node:fs";
import { build } from "./build.js";
export async function batch(inputPath, opts) {
    const specs = JSON.parse(readFileSync(inputPath, "utf8"));
    for (const specPath of specs)
        await build(specPath, opts);
}
