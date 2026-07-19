// Audio source resolution for spec.sfx[] and spec.music: a bare id ("whoosh" — no slash, no
// extension) resolves from the shared library at assets-lib/sfx/<id>.(mp3|wav); anything
// path-like resolves through project.assetPath() with the usual traversal guard. Throws on
// missing files so a bad ref fails the build before any API spend.
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
// src/media and dist/media are both two levels under the package root (same trick as render.ts).
export const SFX_LIB_DIR = resolve(here, "../../assets-lib/sfx");

const LIB_EXTS = [".mp3", ".wav"];

function libraryIds(): string[] {
  if (!existsSync(SFX_LIB_DIR)) return [];
  return readdirSync(SFX_LIB_DIR)
    .filter((f) => LIB_EXTS.some((e) => f.toLowerCase().endsWith(e)))
    .map((f) => f.replace(/\.[^.]+$/, ""));
}

export function resolveAudioSource(src: string, project: { assetPath(rel: string): string }): string {
  const bareId = !src.includes("/") && !src.includes(".");
  if (bareId) {
    for (const ext of LIB_EXTS) {
      const p = join(SFX_LIB_DIR, src + ext);
      if (existsSync(p)) return p;
    }
    const ids = libraryIds();
    throw new Error(
      `Unknown sfx id "${src}" — ${ids.length ? `library has: ${ids.join(", ")}` : "the shared library (assets-lib/sfx/) is empty"}. ` +
        `Use a project asset path (e.g. "sfx/${src}.mp3") or add the file to the library.`,
    );
  }
  const abs = project.assetPath(src); // throws on traversal
  if (!existsSync(abs)) throw new Error(`Missing audio asset: assets/${src}`);
  return abs;
}
