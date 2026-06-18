// batch: build many specs in one invocation — reads a JSON array of spec paths and runs build() on
// each in sequence (same options applied to all).
import { readFileSync } from "node:fs";
import { build } from "./build.js";

export async function batch(inputPath: string, opts: { mock?: boolean }): Promise<void> {
  const specs = JSON.parse(readFileSync(inputPath, "utf8")) as string[];
  for (const specPath of specs) await build(specPath, opts);
}
