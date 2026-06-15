import { describe, it, expect } from "vitest";
import { contentHash } from "../src/media/hash.js";
import { Cache } from "../src/media/cache.js";
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
