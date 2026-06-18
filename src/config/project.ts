import { existsSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

// Join `rel` under `base`, rejecting any result that escapes `base` (path traversal via ../ or an
// absolute rel). Asset/motion sources are project-scoped, so `source: "../../etc/passwd"` must not read
// outside the project — and a .js motion source outside the project would be executed as code.
export function containedPath(base: string, rel: string): string {
  const abs = resolve(base, rel);
  if (abs !== base && !abs.startsWith(base + sep)) {
    throw new Error(`Asset path escapes the project assets dir: ${rel}`);
  }
  return abs;
}

export interface Project {
  workspaceRoot: string; // holds shared brands/ + .kino-cache
  projectRoot: string; // holds this project's specs/ assets/ out/ (== workspaceRoot in flat mode)
  cache: string;
  projectConfigPath: string | null; // projectRoot/project.json, if present
  isProject: boolean;
  brandDir(name: string): string; // shared, at the workspace
  assetPath(rel: string): string; // scoped to the project
  outDir(title: string): string; // scoped to the project
}

// Nearest ancestor directory (inclusive of startDir) that contains `marker`, else null.
// existsFn is injectable for testing.
export function findUp(startDir: string, marker: string, existsFn: (p: string) => boolean = existsSync): string | null {
  let dir = startDir;
  for (;;) {
    if (existsFn(join(dir, marker))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// Resolve the workspace (shared brands) + the active project (scoped specs/assets/out).
//   - project name → workspaceRoot/projects/<name>
//   - else spec path → walk up to the nearest project.json
//   - else (flat / back-compat) → project root == workspace root
export function resolveProject(opts: { specPath?: string; project?: string; cwd?: string } = {}): Project {
  const cwd = opts.cwd ?? process.cwd();
  const workspaceRoot = findUp(cwd, "brands") ?? cwd;

  let projectRoot: string;
  if (opts.project) {
    projectRoot = join(workspaceRoot, "projects", opts.project);
  } else if (opts.specPath) {
    projectRoot = findUp(resolve(dirname(opts.specPath)), "project.json") ?? workspaceRoot;
  } else {
    projectRoot = workspaceRoot;
  }

  const cp = join(projectRoot, "project.json");
  const projectConfigPath = existsSync(cp) ? cp : null;

  return {
    workspaceRoot,
    projectRoot,
    cache: join(workspaceRoot, ".kino-cache"),
    projectConfigPath,
    isProject: projectConfigPath !== null,
    brandDir: (name) => join(workspaceRoot, "brands", name),
    assetPath: (rel) => containedPath(join(projectRoot, "assets"), rel),
    outDir: (title) => join(projectRoot, "out", title),
  };
}
