import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAudioSource, SFX_LIB_DIR, MUSIC_LIB_DIR, listMusicIds, listSfxIds } from "../src/media/sfx.js";
import { containedPath } from "../src/config/project.js";
import { SpecSchema, musicBeds } from "../src/spec/schema.js";
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
    expect(() => resolveAudioSource("no-such-sound-xyz", p)).toThrow(/Unknown audio id/);
  });

  it("SFX_LIB_DIR / MUSIC_LIB_DIR point at assets-lib in the package", () => {
    expect(SFX_LIB_DIR.endsWith(join("assets-lib", "sfx"))).toBe(true);
    expect(MUSIC_LIB_DIR.endsWith(join("assets-lib", "music"))).toBe(true);
  });

  it("ships empty sfx and music libraries", () => {
    expect(listSfxIds()).toEqual([]);
    expect(listMusicIds()).toEqual([]);
  });
});

const baseSpec = {
  title: "sfx-check",
  segments: [{ kind: "scene", text: "hi", caption: "hi" }],
};

describe("spec sfx/music schema", () => {
  it("parses sfx events and applies the volume/pan/rate/fade defaults", () => {
    const s = SpecSchema.parse({ ...baseSpec, sfx: [{ src: "pop", at: 2.4 }] });
    expect(s.sfx![0]).toEqual({ src: "pop", at: 2.4, volume: 1, pan: 0, rate: 1, fadeInSec: 0, fadeOutSec: 0 });
  });

  it("parses sfx pan, rate and fades", () => {
    const s = SpecSchema.parse({ ...baseSpec, sfx: [{ src: "pop", at: 1, pan: -1, rate: 1.5, fadeInSec: 0.02, fadeOutSec: 0.1 }] });
    expect(s.sfx![0]).toMatchObject({ pan: -1, rate: 1.5, fadeInSec: 0.02, fadeOutSec: 0.1 });
  });

  it("rejects a negative fade", () => {
    expect(() => SpecSchema.parse({ ...baseSpec, sfx: [{ src: "pop", at: 1, fadeInSec: -0.1 }] })).toThrow();
    expect(() => SpecSchema.parse({ ...baseSpec, sfx: [{ src: "pop", at: 1, fadeOutSec: -1 }] })).toThrow();
  });

  it("rejects pan outside -1..1 and a non-positive rate", () => {
    expect(() => SpecSchema.parse({ ...baseSpec, sfx: [{ src: "pop", at: 1, pan: 1.5 }] })).toThrow();
    expect(() => SpecSchema.parse({ ...baseSpec, sfx: [{ src: "pop", at: 1, rate: 0 }] })).toThrow();
    expect(() => SpecSchema.parse({ ...baseSpec, sfx: [{ src: "pop", at: 1, rate: -1 }] })).toThrow();
  });

  it("parses music with defaults — and leaves `keyframes` absent so old props stay byte-identical", () => {
    const s = SpecSchema.parse({ ...baseSpec, music: { src: "bed/track.mp3" } });
    expect(s.music).toEqual({ src: "bed/track.mp3", volume: 0.12, duck: 0.04, fadeInSec: 0, fadeOutSec: 2, startSec: 0 });
  });

  it("accepts a single bed or an array of beds, and musicBeds normalizes both", () => {
    const one = SpecSchema.parse({ ...baseSpec, music: { src: "a.mp3" } });
    const many = SpecSchema.parse({ ...baseSpec, music: [{ src: "a.mp3" }, { src: "b.mp3", volume: 0.3 }] });
    expect(musicBeds(one).map((b) => b.src)).toEqual(["a.mp3"]);
    expect(musicBeds(many).map((b) => b.src)).toEqual(["a.mp3", "b.mp3"]);
    expect(musicBeds({ music: undefined })).toEqual([]);
    // By reference, so `kino sync` can write startSec straight back into the loaded spec.
    musicBeds(one)[0].startSec = 4;
    expect((one.music as { startSec: number }).startSec).toBe(4);
  });

  it("rejects an empty music array — an author meant to write something", () => {
    expect(() => SpecSchema.parse({ ...baseSpec, music: [] })).toThrow();
  });

  it("parses music keyframes and rejects a typo'd param", () => {
    const s = SpecSchema.parse({
      ...baseSpec,
      music: { src: "a.mp3", keyframes: [{ at: 3, params: { volume: 0 }, ease: "easeOut" }] },
    });
    expect((s.music as { keyframes: unknown[] }).keyframes).toEqual([{ at: 3, params: { volume: 0 }, ease: "easeOut" }]);
    expect(() => SpecSchema.parse({ ...baseSpec, music: { src: "a.mp3", keyframes: [{ at: 1, params: { vol: 0.2 } }] } })).toThrow();
    expect(() => SpecSchema.parse({ ...baseSpec, music: { src: "a.mp3", keyframes: [{ at: 1, params: { volume: 2 } }] } })).toThrow();
  });

  it("applies the voVolume default and rejects out-of-range gain", () => {
    expect(SpecSchema.parse(baseSpec).voVolume).toBe(1);
    expect(SpecSchema.parse({ ...baseSpec, voVolume: 0.6 }).voVolume).toBe(0.6);
    expect(() => SpecSchema.parse({ ...baseSpec, voVolume: 1.4 })).toThrow();
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
