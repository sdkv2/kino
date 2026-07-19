import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAudioSource, SFX_LIB_DIR } from "../src/media/sfx.js";
import { containedPath } from "../src/config/project.js";
import { SpecSchema } from "../src/spec/schema.js";
import { assertAudioSources } from "../src/spec/validate.js";

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

const baseSpec = {
  title: "sfx-check",
  segments: [{ kind: "avatar", text: "hi", caption: "hi" }],
};

describe("spec sfx/music schema", () => {
  it("parses sfx events and applies the volume default", () => {
    const s = SpecSchema.parse({ ...baseSpec, sfx: [{ src: "whoosh", at: 2.4 }] });
    expect(s.sfx![0]).toEqual({ src: "whoosh", at: 2.4, volume: 1 });
  });

  it("parses music with defaults", () => {
    const s = SpecSchema.parse({ ...baseSpec, music: { src: "bed/track.mp3" } });
    expect(s.music).toEqual({ src: "bed/track.mp3", volume: 0.18, duck: 0.06, fadeOutSec: 2 });
  });

  it("rejects out-of-range volume and negative at", () => {
    expect(() => SpecSchema.parse({ ...baseSpec, sfx: [{ src: "x/y.mp3", at: -1 }] })).toThrow();
    expect(() => SpecSchema.parse({ ...baseSpec, sfx: [{ src: "x/y.mp3", at: 0, volume: 2 }] })).toThrow();
  });
});

describe("assertAudioSources", () => {
  it("throws for a missing sfx file, naming the segment-free location", () => {
    const p = fakeProject(mkdtempSync(join(tmpdir(), "kino-sfxv-")));
    const spec = SpecSchema.parse({ ...baseSpec, sfx: [{ src: "sfx/none.mp3", at: 1 }] });
    expect(() => assertAudioSources(spec, p)).toThrow(/sfx\[0\]/);
  });

  it("throws for missing music", () => {
    const p = fakeProject(mkdtempSync(join(tmpdir(), "kino-sfxv-")));
    const spec = SpecSchema.parse({ ...baseSpec, music: { src: "bed/none.mp3" } });
    expect(() => assertAudioSources(spec, p)).toThrow(/music/);
  });

  it("passes when files exist", () => {
    const root = mkdtempSync(join(tmpdir(), "kino-sfxv-"));
    const p = fakeProject(root);
    mkdirSync(join(root, "assets", "sfx"), { recursive: true });
    writeFileSync(join(root, "assets", "sfx", "hit.mp3"), "x");
    const spec = SpecSchema.parse({ ...baseSpec, sfx: [{ src: "sfx/hit.mp3", at: 1 }] });
    expect(() => assertAudioSources(spec, p)).not.toThrow();
  });
});
