import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { frameCacheCovers, openFrameCache } from "../src/render/native/frameCache.js";

// This predicate gates whether media extraction runs at all, so a false positive is not a slow
// render — it is a render with the footage silently missing. Every case below is a way it could
// wrongly answer "covered".
describe("frameCacheCovers", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kino-cache-test-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Populate a cache the way a render would, through the real writer. */
  async function fill(sigs: string[]): Promise<void> {
    const c = openFrameCache(dir, sigs);
    for (let n = 0; n < sigs.length; n++) await c.put(n, Buffer.from(`frame-${n}`));
    c.commit();
  }

  it("reports covered only once every frame has been written and committed", async () => {
    const sigs = ["a", "b", "c"];
    expect(frameCacheCovers(dir, sigs, {})).toBe(false);
    await fill(sigs);
    expect(frameCacheCovers(dir, sigs, {})).toBe(true);
  });

  it("is not fooled by a manifest whose frame file was deleted", async () => {
    const sigs = ["a", "b", "c"];
    await fill(sigs);
    // openFrameCache's `get` treats a missing file as a miss, so claiming coverage here would
    // strand the render: no cached frame AND no extracted media to re-render it from.
    // Delete whatever the writer actually produced rather than hardcoding its naming.
    const frames = readdirSync(dir).filter((f) => f !== "manifest.json");
    expect(frames.length).toBeGreaterThan(0);
    rmSync(join(dir, frames[0]!), { force: true });
    expect(frameCacheCovers(dir, sigs, {})).toBe(false);
  });

  it("rejects a cache written for different content", async () => {
    await fill(["a", "b", "c"]);
    expect(frameCacheCovers(dir, ["a", "b", "DIFFERENT"], {})).toBe(false);
  });

  it("rejects a shorter cache than the render needs", async () => {
    await fill(["a", "b"]);
    expect(frameCacheCovers(dir, ["a", "b", "c"], {})).toBe(false);
  });

  it("rejects a stale manifest version", async () => {
    await fill(["a"]);
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ version: -1, sigs: { 0: "a" } }));
    expect(frameCacheCovers(dir, ["a"], {})).toBe(false);
  });

  it("never claims coverage when the frame cache is disabled", async () => {
    const sigs = ["a", "b"];
    await fill(sigs);
    // openFrameCache returns a null cache under this flag, so every frame would miss.
    expect(frameCacheCovers(dir, sigs, { KINO_NO_FRAME_CACHE: "1" })).toBe(false);
  });

  it("returns false for an empty render rather than vacuously true", () => {
    expect(frameCacheCovers(dir, [], {})).toBe(false);
  });

  it("returns false on a directory that does not exist", () => {
    expect(frameCacheCovers(join(dir, "nope"), ["a"], {})).toBe(false);
  });
});
