// Background draw-fn resolution: bare id ("brand-wash") → assets-lib/backgrounds/<id>.js;
// otherwise project assets/ path, then workspace-relative (brand.backgroundComponent).
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { Project } from "../config/project.js";

const here = dirname(fileURLToPath(import.meta.url));
export const BACKGROUND_LIB_DIR = resolve(here, "../../assets-lib/backgrounds");

function isBareId(src: string): boolean {
  return !src.includes("/") && !src.includes(".");
}

export function listBackgroundIds(): string[] {
  if (!existsSync(BACKGROUND_LIB_DIR)) return [];
  return readdirSync(BACKGROUND_LIB_DIR)
    .filter((f) => f.toLowerCase().endsWith(".js"))
    .map((f) => f.slice(0, -3))
    .sort();
}

export function resolveBackgroundComponent(src: string, project: Project): string {
  if (isBareId(src)) {
    const hit = join(BACKGROUND_LIB_DIR, `${src}.js`);
    if (!existsSync(hit)) {
      const ids = listBackgroundIds();
      throw new Error(
        `Unknown background id "${src}" — ${
          ids.length ? `library has: ${ids.join(", ")}` : "assets-lib/backgrounds/ is empty"
        }. Use a project path (e.g. "backgrounds/${src}.js") or add the file to assets-lib/backgrounds/.`,
      );
    }
    return hit;
  }
  const asAsset = project.assetPath(src);
  if (existsSync(asAsset)) return asAsset;
  const asWorkspace = isAbsolute(src) ? src : join(project.workspaceRoot, src);
  if (existsSync(asWorkspace)) return asWorkspace;
  throw new Error(
    `Background component not found: tried assets/${src} and ${src} (workspace). ` +
      `For a library draw fn use a bare id (kino backgrounds).`,
  );
}
