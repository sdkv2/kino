// Lens / motion-effect shader resolution: bare id ("liquid-glass") → assets-lib/effects/<id>.{frag,glsl};
// otherwise project assets/ path, then workspace-relative.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import type { KinoProps, MotionGraphicProps } from "../render/props.js";
import { DEFAULT_LENS_ID, LENS_CLASS_RE } from "../render/lensContract.js";

const here = dirname(fileURLToPath(import.meta.url));
export const EFFECTS_LIB_DIR = resolve(here, "../../assets-lib/effects");
export { DEFAULT_LENS_ID, LENS_CLASS_RE };

const SHADER_EXTS = [".frag", ".glsl"];

export type EffectResolveProject = {
  assetPath(rel: string): string;
  workspaceRoot?: string;
};

function isBareId(src: string): boolean {
  return !src.includes("/") && !src.includes(".");
}

export function listEffectIds(): string[] {
  if (!existsSync(EFFECTS_LIB_DIR)) return [];
  return readdirSync(EFFECTS_LIB_DIR)
    .filter((f) => SHADER_EXTS.includes(extname(f).toLowerCase()))
    .map((f) => f.slice(0, -extname(f).length))
    .sort();
}

export function resolveEffectComponent(src: string, project?: EffectResolveProject): string {
  if (isBareId(src)) {
    const hits = SHADER_EXTS.map((ext) => join(EFFECTS_LIB_DIR, `${src}${ext}`)).filter((p) => existsSync(p));
    if (hits.length > 1) {
      throw new Error(
        `Ambiguous effect id "${src}" — multiple files match (${hits
          .map((h) => h.slice(EFFECTS_LIB_DIR.length + 1))
          .join(", ")}). Reference one by path to disambiguate.`,
      );
    }
    if (hits.length === 0) {
      const ids = listEffectIds();
      throw new Error(
        `Unknown effect id "${src}" — ${
          ids.length ? `library has: ${ids.join(", ")}` : "assets-lib/effects/ is empty"
        }. Use a project path or add the file to assets-lib/effects/.`,
      );
    }
    return hits[0];
  }
  if (project) {
    const asAsset = project.assetPath(src);
    if (existsSync(asAsset)) return asAsset;
    if (project.workspaceRoot) {
      const asWorkspace = isAbsolute(src) ? src : join(project.workspaceRoot, src);
      if (existsSync(asWorkspace)) return asWorkspace;
    }
  } else if (isAbsolute(src) && existsSync(src)) {
    return src;
  }
  throw new Error(
    `Effect component not found: ${src}. For a library lens use a bare id (e.g. "${DEFAULT_LENS_ID}").`,
  );
}

/** Ids referenced by lens markup/proc source. Null when no lens class present. */
export function collectLensIds(source: string): string[] | null {
  if (!LENS_CLASS_RE.test(source)) return null;
  const ids = new Set<string>([DEFAULT_LENS_ID]);
  for (const m of source.matchAll(/data-lens\s*=\s*["']([^"']+)["']/gi)) {
    const id = m[1]?.trim();
    if (id) ids.add(id);
  }
  return [...ids];
}

/** Load shader source map for every lens id in `source`. */
export function collectLensShaders(
  source: string,
  project?: EffectResolveProject,
): Record<string, string> | undefined {
  const ids = collectLensIds(source);
  if (!ids) return undefined;
  const out: Record<string, string> = {};
  for (const id of ids) {
    const path = resolveEffectComponent(id, project);
    out[id] = readFileSync(path, "utf8");
  }
  return out;
}

/** Attach missing lensShaders on a resolved motion graphic (idempotent). */
export function attachLensShaders(
  motion: MotionGraphicProps,
  project?: EffectResolveProject,
): MotionGraphicProps {
  if (motion.lensShaders && Object.keys(motion.lensShaders).length > 0) return motion;
  const source = motion.html || motion.proc || "";
  const shaders = collectLensShaders(source, project);
  if (!shaders) return motion;
  return { ...motion, lensShaders: shaders };
}

/** Fill lensShaders on every motion / overlay that needs them (hand-built test props, etc.). */
export function hydratePropsLensShaders(props: KinoProps, project?: EffectResolveProject): KinoProps {
  let touched = false;
  const segments = props.segments.map((seg) => {
    let next = seg;
    if (seg.motion) {
      const m = attachLensShaders(seg.motion, project);
      if (m !== seg.motion) {
        touched = true;
        next = { ...next, motion: m };
      }
    }
    if ("motionOverlay" in next && next.motionOverlay) {
      const o = attachLensShaders(next.motionOverlay, project);
      if (o !== next.motionOverlay) {
        touched = true;
        next = { ...next, motionOverlay: o };
      }
    }
    return next;
  });
  return touched ? { ...props, segments } : props;
}
