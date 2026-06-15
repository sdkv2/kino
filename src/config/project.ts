import { join } from "node:path";

export interface Project {
  root: string;
  brands: string;
  assets: string;
  specs: string;
  out: string;
  cache: string;
  brandDir(name: string): string;
  assetPath(rel: string): string;
  outDir(title: string): string;
}

export function resolveProject(root: string = process.cwd()): Project {
  return {
    root,
    brands: join(root, "brands"),
    assets: join(root, "assets"),
    specs: join(root, "specs"),
    out: join(root, "out"),
    cache: join(root, ".kino-cache"),
    brandDir: (name) => join(root, "brands", name),
    assetPath: (rel) => join(root, "assets", rel),
    outDir: (title) => join(root, "out", title),
  };
}
