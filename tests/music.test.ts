import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { catalogBeds, copyMusicBed, resolveMusicBed, MUSIC_BEDS } from "../src/media/music.js";
import { containedPath } from "../src/config/project.js";
import { MUSIC_LIB_DIR } from "../src/media/sfx.js";

describe("music catalog", () => {
  it("lists every catalogued bed that exists on disk", () => {
    const beds = catalogBeds();
    expect(beds.length).toBe(MUSIC_BEDS.length);
    for (const b of beds) {
      expect(existsSync(b.path)).toBe(true);
      expect(b.path.startsWith(MUSIC_LIB_DIR)).toBe(true);
    }
  });

  it("resolveMusicBed returns the library file", () => {
    expect(resolveMusicBed("ambient-night")).toBe(join(MUSIC_LIB_DIR, "ambient-night.mp3"));
  });

  it("resolveMusicBed throws for unknown ids", () => {
    expect(() => resolveMusicBed("no-such-bed-xyz")).toThrow(/Unknown music id/);
  });

  it("copyMusicBed writes into the project assets dir once", () => {
    const root = mkdtempSync(join(tmpdir(), "kino-music-"));
    mkdirSync(join(root, "assets"), { recursive: true });
    const assetPath = (rel: string) => containedPath(join(root, "assets"), rel);
    const rel = copyMusicBed("ambient-night", assetPath);
    expect(rel).toBe(join("music", "ambient-night.mp3"));
    const dest = assetPath(rel);
    expect(existsSync(dest)).toBe(true);
    const before = readFileSync(dest);
    copyMusicBed("ambient-night", assetPath); // no overwrite thrash
    expect(readFileSync(dest)).toEqual(before);
  });
});
