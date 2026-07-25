import { describe, it, expect } from "vitest";
import { cacheKeyFor } from "../src/render/native/page/compositor/providers/html.js";

describe("cacheKeyFor", () => {
  it("keys a static layer by a constant — one raster for the whole render", () => {
    expect(cacheKeyFor("static", 0, undefined)).toBe("static");
    expect(cacheKeyFor("static", 500, "w7")).toBe("static");
  });

  it("keys a keyed layer by the layer's content key", () => {
    expect(cacheKeyFor("keyed", 42, "w3")).toBe("k:w3");
    expect(cacheKeyFor("keyed", 99, "w3")).toBe("k:w3");
  });

  it("falls back to the frame when a keyed layer has no content key", () => {
    expect(cacheKeyFor("keyed", 42, undefined)).toBe("f:42");
  });

  it("keys a dynamic layer by the frame — every frame is its own raster", () => {
    expect(cacheKeyFor("dynamic", 42, "w3")).toBe("f:42");
  });
});
