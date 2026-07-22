import { describe, it, expect } from "vitest";
import { contentHash } from "../src/media/hash.js";
import { Cache } from "../src/media/cache.js";
import { frameSignatures } from "../src/render/native/frameCache.js";
import type { KinoProps } from "../src/render/props.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("contentHash", () => {
  it("is stable and order-independent for objects", () => {
    expect(contentHash({ a: 1, b: 2 })).toBe(contentHash({ b: 2, a: 1 }));
    expect(contentHash("x")).not.toBe(contentHash("y"));
  });
});

describe("Cache", () => {
  it("stores and retrieves a file path by key", () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-cache-"));
    const cache = new Cache(dir);
    const key = contentHash({ text: "hi", voice: "v1" });
    expect(cache.get(key, "mp3")).toBeNull();
    const src = join(dir, "src.mp3");
    writeFileSync(src, "audio");
    const stored = cache.put(key, "mp3", src);
    expect(cache.get(key, "mp3")).toBe(stored);
  });
});

describe("frameSignatures scene assets", () => {
  it("changes covered frames' signatures when a scene asset's bytes change", () => {
    const publicDir = mkdtempSync(join(tmpdir(), "kino-scene-pub-"));
    writeFileSync(join(publicDir, "a.png"), "AA");
    const props = {
      fps: 30,
      segments: [
        {
          kind: "motion",
          startSec: 5,
          endSec: 10,
          motion: { html: "", scene: "return () => {};", sceneAssets: ["a.png"], params: {}, keyframes: [], triggers: [] },
        },
      ],
    } as unknown as KinoProps;
    const sigOpts = { publicDir, pageJsHash: "pj", width: 1080, height: 1920, total: 300, fps: 30 };
    const a = frameSignatures({ ...sigOpts, props });
    // Segment spans frames 150–300 with a 30-frame pad → covers 120..300; frames < 120 are out of range.
    writeFileSync(join(publicDir, "a.png"), "BBBB"); // different length → different statSig
    const b = frameSignatures({ ...sigOpts, props });
    for (let n = 0; n < 120; n++) expect(b[n]).toBe(a[n]);
    for (let n = 120; n < 300; n++) expect(b[n]).not.toBe(a[n]);
  });
});

describe("frameSignatures render mode", () => {
  const publicDir = mkdtempSync(join(tmpdir(), "kino-mode-pub-"));
  const props = {
    fps: 30,
    segments: [
      { kind: "motion", startSec: 0, endSec: 2, motion: { html: "", scene: "return () => {};", sceneAssets: [], params: {}, keyframes: [], triggers: [] } },
    ],
  } as unknown as KinoProps;
  const sigOpts = { props, publicDir, pageJsHash: "pj", width: 1080, height: 1920, total: 60, fps: 30 };

  it("never cross-serves gpu and software frames for identical props", () => {
    const sw = frameSignatures({ ...sigOpts, mode: "sw" });
    const gpu = frameSignatures({ ...sigOpts, mode: "gpu" });
    for (let n = 0; n < 60; n++) expect(gpu[n]).not.toBe(sw[n]);
  });

  it("is stable within a mode", () => {
    expect(frameSignatures({ ...sigOpts, mode: "sw" })).toEqual(frameSignatures({ ...sigOpts, mode: "sw" }));
    expect(frameSignatures({ ...sigOpts, mode: "gpu" })).toEqual(frameSignatures({ ...sigOpts, mode: "gpu" }));
  });
});
