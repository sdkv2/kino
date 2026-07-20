// Audio source resolution for spec.sfx[] and spec.music: a bare id ("ambient-night" —
// no slash, no extension) resolves from the shared libraries at assets-lib/sfx/ then
// assets-lib/music/; anything path-like resolves through project.assetPath() with the usual
// traversal guard. Throws on missing files so a bad ref fails the build before any API spend.
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
// src/media and dist/media are both two levels under the package root (same trick as render.ts).
export const SFX_LIB_DIR = resolve(here, "../../assets-lib/sfx");
export const MUSIC_LIB_DIR = resolve(here, "../../assets-lib/music");

const LIB_EXTS = [".mp3", ".wav"];

function idsIn(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => LIB_EXTS.some((e) => f.toLowerCase().endsWith(e)))
    .map((f) => f.replace(/\.[^.]+$/, ""))
    .sort();
}

export function listSfxIds(): string[] {
  return idsIn(SFX_LIB_DIR);
}

export function listMusicIds(): string[] {
  return idsIn(MUSIC_LIB_DIR);
}

function findInLib(dir: string, id: string): string | null {
  for (const ext of LIB_EXTS) {
    const p = join(dir, id + ext);
    if (existsSync(p)) return p;
  }
  return null;
}

export function resolveAudioSource(src: string, project: { assetPath(rel: string): string }): string {
  const bareId = !src.includes("/") && !src.includes(".");
  if (bareId) {
    // Music beds and SFX share the bare-id namespace; check both libs (sfx first — shorter hits).
    const hit = findInLib(SFX_LIB_DIR, src) ?? findInLib(MUSIC_LIB_DIR, src);
    if (hit) return hit;
    const sfx = listSfxIds();
    const music = listMusicIds();
    const parts = [
      sfx.length ? `sfx: ${sfx.join(", ")}` : "sfx library empty",
      music.length ? `music: ${music.join(", ")}` : "music library empty",
    ];
    throw new Error(
      `Unknown audio id "${src}" — ${parts.join("; ")}. ` +
        `Use a project asset path (e.g. "sfx/${src}.mp3" or "music/${src}.mp3") or add the file to assets-lib.`,
    );
  }
  const abs = project.assetPath(src); // throws on traversal
  if (!existsSync(abs)) throw new Error(`Missing audio asset: assets/${src}`);
  return abs;
}
