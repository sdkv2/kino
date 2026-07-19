// Bundled music-bed catalog for `kino music`. Files live in assets-lib/music/; agents use bare
// ids in the spec (`"music": { "src": "ambient-night" }`) — no CDN scrape, no API key.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { listMusicIds, MUSIC_LIB_DIR } from "./sfx.js";

export interface MusicBedMeta {
  id: string;
  mood: string;
  use: string;
}

/** Mood hints for the curated beds — keep in sync with files in assets-lib/music/. */
export const MUSIC_BEDS: MusicBedMeta[] = [
  { id: "ambient-night", mood: "dark, soft pad", use: "sleep / wellness / night brands" },
  { id: "warm-drone", mood: "low, mellow drone", use: "calm narrative, luxury soft-sell" },
  { id: "soft-piano", mood: "gentle piano tones", use: "editorial, reflection, app stories" },
  { id: "calm-pulse", mood: "soft pulsing sub", use: "breathing / habit / focus apps" },
  { id: "bright-lift", mood: "brighter soft lift", use: "product reveal, friendly SaaS" },
  { id: "chill-groove", mood: "light groove pulse", use: "lifestyle, casual consumer" },
];

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
