// Motion source resolution: a bare id ("prompt-type" — no slash, no extension) resolves from
// assets-lib/motion/<id>.{js,html,json}; path-like refs resolve through project.assetPath() with
// the usual traversal guard. Mirrors resolveAudioSource in sfx.ts.
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
export const MOTION_LIB_DIR = resolve(here, "../../assets-lib/motion");

// ".scene.js" before ".js": listMotionIds strips the FIRST matching ext, and "x.scene.js"
// endsWith ".js" — order is the correctness, not a preference.
const LIB_EXTS = [".scene.js", ".js", ".html", ".json"] as const;

function isBareId(src: string): boolean {
  return !src.includes("/") && !src.includes(".");
}

export function listMotionIds(): string[] {
  if (!existsSync(MOTION_LIB_DIR)) return [];
  const seen = new Set<string>();
  for (const f of readdirSync(MOTION_LIB_DIR)) {
    const lower = f.toLowerCase();
    const ext = LIB_EXTS.find((e) => lower.endsWith(e));
    if (!ext) continue;
    seen.add(f.slice(0, -ext.length));
  }
  return [...seen].sort();
}

function findInLib(id: string): string | null {
  const hits = LIB_EXTS.map((ext) => join(MOTION_LIB_DIR, id + ext)).filter((p) => existsSync(p));
  if (hits.length > 1) {
    throw new Error(
      `Motion id "${id}" is ambiguous — both ${hits
        .map((h) => h.split(/[/\\]/).pop())
        .join(" and ")} exist in assets-lib/motion/. Rename one.`,
    );
  }
  return hits[0] ?? null;
}

export type ResolvedMotionSource = {
  abs: string;
  /** Path used for lint/errors — bare id keeps the id; project paths keep assets/… */
  display: string;
  /** Basename with extension, for lintMotionSource extension dispatch */
  fileName: string;
};

export function resolveMotionSource(
  src: string,
  project: { assetPath(rel: string): string },
): ResolvedMotionSource {
  if (isBareId(src)) {
    const hit = findInLib(src);
    if (!hit) {
      const ids = listMotionIds();
      throw new Error(
        `Unknown motion id "${src}" — ${
          ids.length ? `library has: ${ids.join(", ")}` : "assets-lib/motion/ is empty"
        }. Use a project path (e.g. "motion/${src}.js") or add the file to assets-lib/motion/.`,
      );
    }
    return { abs: hit, display: src, fileName: hit.split(/[/\\]/).pop()! };
  }
  const abs = project.assetPath(src);
  if (!existsSync(abs)) throw new Error(`Missing motion graphic file: assets/${src}`);
  return { abs, display: `assets/${src}`, fileName: src.split(/[/\\]/).pop()! };
}
