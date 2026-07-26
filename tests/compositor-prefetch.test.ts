import { describe, it, expect } from "vitest";
import { nextFrameKeys } from "../src/render/native/page/compositor/prefetch.js";
import { normalizeLayer } from "../src/render/native/page/compositor/graph.js";

const layer = (id: string, key?: string) =>
  normalizeLayer({ id, source: { providerId: id, key }, rect: { x: 0, y: 0, w: 10, h: 10 } });

describe("nextFrameKeys", () => {
  it("names the sources the next frame will need", () => {
    const keys = nextFrameKeys([layer("motion0", "41")], [layer("motion0", "42")]);
    expect(keys).toEqual([{ providerId: "motion0", key: "42" }]);
  });

  it("skips sources whose key is unchanged — already cached", () => {
    expect(nextFrameKeys([layer("caption0", "w3")], [layer("caption0", "w3")])).toEqual([]);
  });

  it("includes a source that appears for the first time", () => {
    const keys = nextFrameKeys([layer("motion0", "10")], [layer("motion0", "11"), layer("overlay0", "0")]);
    expect(keys.map((k) => k.providerId).sort()).toEqual(["motion0", "overlay0"]);
  });

  it("ignores sources that are leaving", () => {
    expect(nextFrameKeys([layer("motion0", "59"), layer("caption0", "w2")], [layer("caption0", "w2")])).toEqual([]);
  });
});
