// batch: build many specs in one invocation.
//   Legacy: JSON array of spec paths — ["specs/a.json", "specs/b.json"]
//   Variants: { "base": "specs/advert.json", "variants": [{ "tag": "hook-a", "set": {…} }] }
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { build } from "./build.js";
import { applySets } from "../media/batchSet.js";
import { parseSpec } from "../spec/schema.js";
import { resolveProject } from "../config/project.js";
import { log } from "../log.js";

export type BatchVariant = {
  tag: string;
  set?: Record<string, unknown>;
  format?: string;
  mock?: boolean;
};

export type BatchVariantsFile = {
  base: string;
  variants: BatchVariant[];
};

function resolveBeside(inputPath: string, rel: string): string {
  if (isAbsolute(rel)) return rel;
  return resolve(dirname(resolve(inputPath)), rel);
}

export async function batch(
  inputPath: string,
  opts: { mock?: boolean; project?: string } = {},
): Promise<void> {
  const absInput = resolve(inputPath);
  const raw = JSON.parse(readFileSync(absInput, "utf8")) as unknown;

  if (Array.isArray(raw)) {
    for (const specPath of raw as string[]) {
      await build(resolveBeside(absInput, specPath), { mock: opts.mock, project: opts.project });
    }
    return;
  }

  if (!raw || typeof raw !== "object" || !("base" in raw) || !("variants" in raw)) {
    throw new Error(
      'batch input must be a JSON array of spec paths, or { "base": "…", "variants": [{ "tag": "…", "set": {…} }] }',
    );
  }

  const file = raw as BatchVariantsFile;
  if (!Array.isArray(file.variants) || !file.variants.length) {
    throw new Error("batch variants file needs a non-empty variants[]");
  }

  const basePath = resolveBeside(absInput, file.base);
  const baseSpec = parseSpec(JSON.parse(readFileSync(basePath, "utf8")));
  const project = resolveProject({
    specPath: basePath,
    project: opts.project,
    cwd: dirname(basePath),
  });
  const batchDir = join(project.outDir(baseSpec.title), ".batch");
  mkdirSync(batchDir, { recursive: true });

  for (const v of file.variants) {
    if (!v.tag || typeof v.tag !== "string") throw new Error("each variant needs a string tag");
    const clone = structuredClone(baseSpec);
    if (v.set) applySets(clone, v.set);
    // Keep output titles unique per tag when the set doesn't override title
    if (!v.set || !("title" in v.set)) {
      clone.title = `${baseSpec.title}-${v.tag}`.replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
    }
    const parsed = parseSpec(clone);
    const outSpec = join(batchDir, `${parsed.title}.json`);
    writeFileSync(outSpec, JSON.stringify(parsed, null, 2) + "\n");
    log.info(`batch variant ${v.tag} → ${outSpec}`);
    await build(outSpec, {
      mock: v.mock ?? opts.mock,
      format: v.format,
      tag: v.tag,
      project: opts.project,
    });
  }
}
