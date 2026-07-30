// Custom transition shader resolution: bare id ("iris") → assets-lib/transitions/<id>.{frag,glsl};
// otherwise a project assets/ path, then workspace-relative. Deliberately the same shape as
// backgroundLib so `transitionSource` behaves exactly like `backgroundComponent` — one rule to learn.
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import type { Project } from "../config/project.js";

const here = dirname(fileURLToPath(import.meta.url));
export const TRANSITION_LIB_DIR = resolve(here, "../../assets-lib/transitions");

const LIB_EXTS = [".frag", ".glsl"];

function isBareId(src: string): boolean {
  return !src.includes("/") && !src.includes(".");
}

export function listTransitionIds(): string[] {
  if (!existsSync(TRANSITION_LIB_DIR)) return [];
  return readdirSync(TRANSITION_LIB_DIR)
    .filter((f) => LIB_EXTS.includes(extname(f).toLowerCase()))
    .map((f) => f.slice(0, -extname(f).length))
    .sort();
}

export function resolveTransitionSource(src: string, project: Pick<Project, "assetPath" | "workspaceRoot">): string {
  if (isBareId(src)) {
    const hits = LIB_EXTS.map((ext) => join(TRANSITION_LIB_DIR, `${src}${ext}`)).filter((p) => existsSync(p));
    if (hits.length > 1) {
      throw new Error(
        `Ambiguous transition id "${src}" — multiple files match (${hits
          .map((h) => h.slice(TRANSITION_LIB_DIR.length + 1))
          .join(", ")}). Reference one by path to disambiguate.`,
      );
    }
    if (hits.length === 0) {
      const ids = listTransitionIds();
      throw new Error(
        `Unknown transition id "${src}" — ${
          ids.length ? `library has: ${ids.join(", ")}` : "assets-lib/transitions/ is empty"
        }. Use a project path (e.g. "transitions/${src}.frag") or add the file to assets-lib/transitions/.`,
      );
    }
    return hits[0];
  }
  const asAsset = project.assetPath(src);
  if (existsSync(asAsset)) return asAsset;
  const asWorkspace = isAbsolute(src) ? src : join(project.workspaceRoot, src);
  if (existsSync(asWorkspace)) return asWorkspace;
  throw new Error(
    `Transition shader not found: tried assets/${src} and ${src} (workspace). ` +
      `For a library shader use a bare id (kino transitions).`,
  );
}
