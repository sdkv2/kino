import { join } from "node:path";
export function resolveProject(root = process.cwd()) {
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
