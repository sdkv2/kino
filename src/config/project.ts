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
  projectConfigPath: string; // projectRoot/project.json (always present — a project requires one)
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

// Resolve the shared workspace: nearest ancestor of cwd that contains projects/ or brands/.
// Brands are optional (DEFAULT_BRAND); projects/ alone is enough. Throws when none exists —
// silent cwd fallback hid "not in a workspace" mistakes.
// Pass `{ create: true }` when scaffolding (kino init) so a new root can be born at cwd.
export function resolveWorkspace(
  cwd: string = process.cwd(),
  opts: { create?: boolean } = {},
): Workspace {
  // Walk up; first dir with projects/ or brands/ wins. Nearer projects/ also keeps nested
  // demos/ from latching onto a parent brands/.
  let workspaceRoot: string | null = null;
  let dir = cwd;
  for (;;) {
    if (existsSync(join(dir, "projects")) || existsSync(join(dir, "brands"))) {
      workspaceRoot = dir;
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (!workspaceRoot) workspaceRoot = opts.create ? cwd : null;
  if (!workspaceRoot) {
    throw new Error(
      `No kino workspace found above ${cwd} (looked for projects/ or brands/). ` +
        `Run from a workspace, or: kino init`,
    );
  }
  const root = workspaceRoot;
  return {
    workspaceRoot: root,
    cache: join(root, ".kino-cache"),
    brandDir: (name) => join(root, "brands", name),
  };
}

// Resolve the shared workspace AND the active project. kino requires a project: specs/assets/out
// live under projects/<name>/ with a project.json. Throws (no flat fallback) when none resolves.
//   - project name → workspaceRoot/projects/<name>   (must contain project.json)
//   - spec path    → nearest ancestor that contains project.json
export function resolveProject(opts: { specPath?: string; project?: string; cwd?: string } = {}): Project {
  const cwd = opts.cwd ?? process.cwd();
  // Resolve project first so a nested demos/ workspace (own projects/ or brands/) wins over a
  // parent repo — findUp from cwd alone would latch onto the parent.
  let projectRoot: string | null;
  if (opts.project) {
    // Named project: search workspace from cwd, then look under that workspace's projects/
    const wsFromCwd = resolveWorkspace(cwd);
    projectRoot = join(wsFromCwd.workspaceRoot, "projects", opts.project);
    // If missing, also try cwd/projects/<name> when cwd itself is a demos-style root
    if (!existsSync(join(projectRoot, "project.json")) && existsSync(join(cwd, "projects", opts.project, "project.json"))) {
      projectRoot = join(cwd, "projects", opts.project);
    }
  } else if (opts.specPath) {
    projectRoot = findUp(resolve(dirname(opts.specPath)), "project.json");
  } else {
    projectRoot = null;
  }

  if (!projectRoot || !existsSync(join(projectRoot, "project.json"))) {
    if (opts.project) {
      throw new Error(
        `Project '${opts.project}' not found at projects/${opts.project}/ (no project.json). ` +
          `Create it with: kino projects --new ${opts.project} [--brand <brand>]`,
      );
    }
    const where = opts.specPath ? `spec '${opts.specPath}'` : "this command";
    throw new Error(
      `No project found for ${where}. kino no longer supports a flat layout — every spec must live ` +
        `under projects/<name>/specs/. Create one with: kino projects --new <name> [--brand <brand>]`,
    );
  }

  const pr = projectRoot; // narrowed to string
  // Nearest workspace marker to the project (demos/… → demos; repo root projects → repo root)
  const ws = resolveWorkspace(pr);
  return {
    ...ws,
    projectRoot: pr,
    projectConfigPath: join(pr, "project.json"),
    assetPath: (rel) => containedPath(join(pr, "assets"), rel),
    outDir: (title) => join(pr, "out", title),
  };
}
