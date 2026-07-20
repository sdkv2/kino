// Music-bed helpers for `kino music`. assets-lib/music/ ships empty — drop a CC0 .mp3 there to
// use its bare id in the spec (`"music": { "src": "my-bed" }`), or use a project asset path.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { listMusicIds, MUSIC_LIB_DIR } from "./sfx.js";

export interface MusicBedMeta {
  id: string;
  mood: string;
  use: string;
}

/** Mood hints for curated beds. The library ships empty — entries only for beds dropped into assets-lib/music/. */
export const MUSIC_BEDS: MusicBedMeta[] = [];

export function catalogBeds(): Array<MusicBedMeta & { path: string }> {
  const onDisk = new Set(listMusicIds());
  return MUSIC_BEDS.filter((b) => onDisk.has(b.id)).map((b) => ({
    ...b,
    path: join(MUSIC_LIB_DIR, `${b.id}.mp3`),
  }));
}

/** Absolute path to a library bed (throws if missing). */
export function resolveMusicBed(id: string): string {
  const p = join(MUSIC_LIB_DIR, `${id}.mp3`);
  if (!existsSync(p)) {
    const ids = listMusicIds();
    throw new Error(
      `Unknown music id "${id}" — ${ids.length ? `library has: ${ids.join(", ")}` : "music library empty"}`,
    );
  }
  return p;
}

/** Copy a library bed into a project's assets/music/<id>.mp3 (optional — bare ids already work). */
export function copyMusicBed(id: string, projectAssetPath: (rel: string) => string): string {
  const src = resolveMusicBed(id);
  const rel = join("music", `${id}.mp3`);
  const dest = projectAssetPath(rel);
  mkdirSync(dirname(dest), { recursive: true });
  if (!existsSync(dest)) copyFileSync(src, dest);
  return rel;
}
