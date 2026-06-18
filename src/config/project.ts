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

export interface Workspace {
  workspaceRoot: string; // holds shared brands/ + .kino-cache
  cache: string;
  brandDir(name: string): string; // shared, at the workspace
}

export interface Project extends Workspace {
  projectRoot: string; // holds this project's specs/ assets/ out/
  projectConfigPath: string | null; // projectRoot/project.json, if present
  isProject: boolean;
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

// Resolve the shared workspace: the nearest ancestor of cwd containing a brands/ dir (else cwd),
// which holds shared brands/ and the .kino-cache. Use this for commands that don't need a project.
export function resolveWorkspace(cwd: string = process.cwd()): Workspace {
  const workspaceRoot = findUp(cwd, "brands") ?? cwd;
  return {
    workspaceRoot,
    cache: join(workspaceRoot, ".kino-cache"),
    brandDir: (name) => join(workspaceRoot, "brands", name),
  };
}

// Resolve the workspace (shared brands) + the active project (scoped specs/assets/out).
//   - project name → workspaceRoot/projects/<name>
//   - else spec path → walk up to the nearest project.json
//   - else (flat / back-compat) → project root == workspace root
export function resolveProject(opts: { specPath?: string; project?: string; cwd?: string } = {}): Project {
  const ws = resolveWorkspace(opts.cwd ?? process.cwd());
  const workspaceRoot = ws.workspaceRoot;

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
    ...ws,
    projectRoot,
    projectConfigPath,
    isProject: projectConfigPath !== null,
    assetPath: (rel) => containedPath(join(projectRoot, "assets"), rel),
    outDir: (title) => join(projectRoot, "out", title),
  };
}
