// Background draw-fn / shader resolution: bare id ("brand-wash") → assets-lib/backgrounds/<id>.{js,frag,glsl};
// otherwise project assets/ path, then workspace-relative (brand.backgroundComponent).
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import type { Project } from "../config/project.js";

const here = dirname(fileURLToPath(import.meta.url));
export const BACKGROUND_LIB_DIR = resolve(here, "../../assets-lib/backgrounds");

export const SHADER_EXTS = [".frag", ".glsl"];
const LIB_EXTS = [".js", ...SHADER_EXTS];

/** A resolved component path that should render through the WebGL shader engine (vs Canvas2D). */
export function isShaderPath(p: string): boolean {
  return SHADER_EXTS.includes(extname(p).toLowerCase());
}

function isBareId(src: string): boolean {
  return !src.includes("/") && !src.includes(".");
}

export function listBackgroundIds(): string[] {
  if (!existsSync(BACKGROUND_LIB_DIR)) return [];
  return readdirSync(BACKGROUND_LIB_DIR)
    .filter((f) => LIB_EXTS.includes(extname(f).toLowerCase()))
    .map((f) => f.slice(0, -extname(f).length))
    .sort();
}

export function resolveBackgroundComponent(src: string, project: Project): string {
  if (isBareId(src)) {
    const hits = LIB_EXTS.map((ext) => join(BACKGROUND_LIB_DIR, `${src}${ext}`)).filter((p) => existsSync(p));
    if (hits.length > 1) {
      throw new Error(
        `Ambiguous background id "${src}" — multiple files match (${hits
          .map((h) => h.slice(BACKGROUND_LIB_DIR.length + 1))
          .join(", ")}). Reference one by path to disambiguate.`,
      );
    }
    if (hits.length === 0) {
      const ids = listBackgroundIds();
      throw new Error(
        `Unknown background id "${src}" — ${
          ids.length ? `library has: ${ids.join(", ")}` : "assets-lib/backgrounds/ is empty"
        }. Use a project path (e.g. "backgrounds/${src}.frag") or add the file to assets-lib/backgrounds/.`,
      );
    }
    return hits[0];
  }
  const asAsset = project.assetPath(src);
  if (existsSync(asAsset)) return asAsset;
  const asWorkspace = isAbsolute(src) ? src : join(project.workspaceRoot, src);
  if (existsSync(asWorkspace)) return asWorkspace;
  throw new Error(
    `Background component not found: tried assets/${src} and ${src} (workspace). ` +
      `For a library draw fn or shader use a bare id (kino backgrounds).`,
  );
}
