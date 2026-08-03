import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { frameSignatures, openFrameCache } from "../src/render/native/frameCache.js";

const base = {
  publicDir: "/x",
  pageJsHash: "pj",
  width: 1080,
  height: 1920,
  total: 4,
  fps: 30,
  captureCodec: "h264" as const,
  props: { fps: 30, segments: [] } as never,
};

describe("frameSignatures capture identity", () => {
  it("keys electron capture backends apart — different encoders, different bytes", () => {
    const readback = frameSignatures({ ...base, captureKind: "readback" });
    const direct = frameSignatures({ ...base, captureKind: "direct" });
    expect(readback[0]).not.toBe(direct[0]);
  });

  // Retiring puppeteer removed the `mode` (gpu/sw) and `renderer` INPUTS, but the hashed object
  // must still serialise exactly as the electron path already wrote it: `mode: undefined` (which
  // JSON.stringify drops) and `renderer` pinned to the "electron" literal. Otherwise every existing
  // .frame-cache directory cold-starts on a change that alters no pixels.
  //
  // This hash was captured by running the PRE-removal frameSignatures on the same input, in a
  // detached worktree at the parent commit. A diff here means the key moved: either put it back, or
  // bump VERSION deliberately and regenerate this value.
  // Regenerated at VERSION 9 (*-4k composes at the 1080-class canvas — same key inputs, different
  // pixels, so the version had to move).
  it("keeps the key byte-identical to what the electron path already wrote", () => {
    expect(frameSignatures({ ...base, captureKind: "readback" })[0]).toBe(
      "e7ee2021dbf234ffef061036c48c99753e79fbf9",
    );
  });
});

// The header's stated contract: "Audio never touches the signature." It was only half true —
// `music` was excluded from the hashed props but `sfx` was not, so moving one effect by 100 ms
// re-rendered every frame of the video. The mix is built AFTER capture and muxed with the encoded
// frames; nothing in it can move a pixel.
describe("frameSignatures ignores audio", () => {
  const sig = (props: Record<string, unknown>) =>
    frameSignatures({ ...base, captureKind: "readback", props: { fps: 30, segments: [], ...props } as never })[0];
  const silent = sig({});

  it("is unchanged by adding, moving, or retiming sfx", () => {
    expect(sig({ sfx: [{ src: "sfx-0.mp3", at: 1, volume: 0.5 }] })).toBe(silent);
    expect(sig({ sfx: [{ src: "sfx-0.mp3", at: 1.1, volume: 0.5 }] })).toBe(silent);
    expect(sig({ sfx: [{ src: "sfx-0.mp3", at: 1, volume: 0.5, pan: -1, rate: 1.5 }] })).toBe(silent);
    expect(sig({ sfx: [] })).toBe(silent);
  });

  it("is unchanged by voVolume", () => {
    expect(sig({ voVolume: 0.5 })).toBe(silent);
    expect(sig({ voVolume: 1 })).toBe(silent);
  });

  it("is unchanged by the music beds (single or stacked)", () => {
    expect(sig({ music: [{ src: "music-0.mp3", volume: 0.2, duck: 0.04, duckSpans: [] }] })).toBe(silent);
    expect(sig({ music: [{ src: "a.mp3" }, { src: "b.mp3", keyframes: [{ at: 2, params: { volume: 0 } }] }] })).toBe(silent);
  });

  it("still changes for anything VISUAL — the exclusion is audio-only, not a blanket opt-out", () => {
    expect(sig({ disclosure: "Paid partnership" })).not.toBe(silent);
    expect(sig({ motionBlur: false })).not.toBe(silent);
    expect(sig({ postFx: { grade: { lift: 0.1 } } })).not.toBe(silent);
    expect(sig({ layers: [{ id: "mark", z: 10 }] })).not.toBe(silent);
    expect(sig({ background: { kind: "glow" } })).not.toBe(silent);
  });

  it("keeps a silent spec's existing cache — the key is unmoved for the common case", () => {
    // A spec with no sfx/voVolume hashes exactly as it did before they were excluded, so the
    // short-form default (silent cuts) keeps every cached frame across this upgrade.
    expect(silent).toBe("e7ee2021dbf234ffef061036c48c99753e79fbf9");
  });
});

describe("openFrameCache", () => {
  it("serves a frame written by an identical build", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-fc-test-"));
    const sigs = frameSignatures({ ...base, captureKind: "readback" });

    const wrote = openFrameCache(dir, sigs);
    await wrote.put(0, Buffer.from("electron-frame"));
    wrote.commit();

    const read = openFrameCache(dir, sigs);
    expect((await read.get(0))?.toString()).toBe("electron-frame");
  });

  it("does not serve across a capture-backend change", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-fc-test-"));
    const readback = frameSignatures({ ...base, captureKind: "readback" });
    const direct = frameSignatures({ ...base, captureKind: "direct" });

    const wrote = openFrameCache(dir, readback);
    await wrote.put(0, Buffer.from("readback-frame"));
    wrote.commit();

    const asDirect = openFrameCache(dir, direct);
    expect(await asDirect.get(0)).toBeNull();
    expect(asDirect.hits).toBe(0);
  });

  it("prunes stale .cap files on commit", async () => {
    const { existsSync, readdirSync } = await import("node:fs");
    const dir = mkdtempSync(join(tmpdir(), "kino-fc-test-"));
    const sigs = frameSignatures({ ...base, captureKind: "readback" });

    const cache1 = openFrameCache(dir, sigs);
    await cache1.put(0, Buffer.from("frame-0"));
    await cache1.put(1, Buffer.from("frame-1"));
    cache1.commit();

    expect(readdirSync(dir).filter((f) => f.endsWith(".cap"))).toHaveLength(2);

    // Second run only keeps frame 0, frame 1 should be pruned
    const cache2 = openFrameCache(dir, sigs);
    await cache2.get(0);
    cache2.commit();

    const remaining = readdirSync(dir).filter((f) => f.endsWith(".cap"));
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toBe("f000000.cap");
  });
});
