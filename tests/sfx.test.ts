import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAudioSource, SFX_LIB_DIR } from "../src/media/sfx.js";
import { containedPath } from "../src/config/project.js";

function fakeProject(root: string) {
  mkdirSync(join(root, "assets"), { recursive: true });
  return { assetPath: (rel: string) => containedPath(join(root, "assets"), rel) };
}

describe("resolveAudioSource", () => {
  it("resolves a path-like ref through the project assets dir", () => {
    const root = mkdtempSync(join(tmpdir(), "kino-sfxr-"));
    const p = fakeProject(root);
    mkdirSync(join(root, "assets", "sfx"), { recursive: true });
    writeFileSync(join(root, "assets", "sfx", "hit.mp3"), "x");
    expect(resolveAudioSource("sfx/hit.mp3", p)).toBe(join(root, "assets", "sfx", "hit.mp3"));
  });

  it("throws a clear error for a missing project asset", () => {
    const p = fakeProject(mkdtempSync(join(tmpdir(), "kino-sfxr-")));
    expect(() => resolveAudioSource("sfx/nope.mp3", p)).toThrow(/Missing audio asset.*sfx\/nope\.mp3/);
  });

  it("rejects traversal out of the assets dir", () => {
    const p = fakeProject(mkdtempSync(join(tmpdir(), "kino-sfxr-")));
    expect(() => resolveAudioSource("../evil.mp3", p)).toThrow(/escapes/);
  });

  it("throws listing available ids for an unknown bare id", () => {
    const p = fakeProject(mkdtempSync(join(tmpdir(), "kino-sfxr-")));
    expect(() => resolveAudioSource("no-such-sound-xyz", p)).toThrow(/Unknown sfx id/);
  });

  it("SFX_LIB_DIR points at assets-lib/sfx in the package", () => {
    expect(SFX_LIB_DIR.endsWith(join("assets-lib", "sfx"))).toBe(true);
  });
});
