// Cheap, pure-logic coverage for the draft-canvas sizing rules. The one real render + magick
// pixel compare that used to live in this file is now tests/draft-canvas-render.test.ts, which
// is GPU_PIXEL_TESTS-excluded from KINO_TEST_SCOPE=light — see vitest.config.ts.
import { describe, it, expect } from "vitest";
import { resolveDraftEdge } from "../src/render/native/engine.js";
import { scaledDims, DRAFT_SHORT_EDGE } from "../src/render/formats.js";

describe("scaledDims", () => {
  it("puts the short edge at 720 in every orientation", () => {
    expect(scaledDims("16:9", 720)).toEqual({ width: 1280, height: 720 });
    expect(scaledDims("9:16", 720)).toEqual({ width: 720, height: 1280 });
    expect(scaledDims("3:4", 720)).toEqual({ width: 720, height: 960 });
  });

  it("collapses a 4k format onto the same preview canvas as its 1080 twin", () => {
    for (const base of ["9:16", "3:4", "16:9"] as const) {
      expect(scaledDims(`${base}-4k`, 720)).toEqual(scaledDims(base, 720));
    }
  });

  it("never upscales, and always lands on even edges (yuv420p)", () => {
    expect(scaledDims("16:9", 4000)).toEqual({ width: 1920, height: 1080 });
    for (const edge of [200, 300, 481, 719, 721, 1000]) {
      for (const fmt of ["9:16", "3:4", "16:9", "3:4-4k"] as const) {
        const d = scaledDims(fmt, edge);
        expect(d.width % 2).toBe(0);
        expect(d.height % 2).toBe(0);
      }
    }
  });
});

describe("resolveDraftEdge", () => {
  it("defaults to 720p", () => {
    expect(resolveDraftEdge({})).toBe(DRAFT_SHORT_EDGE);
    expect(resolveDraftEdge({ KINO_DRAFT_EDGE: "" })).toBe(DRAFT_SHORT_EDGE);
  });

  it("takes an explicit edge, and `off` for a full-size draft", () => {
    expect(resolveDraftEdge({ KINO_DRAFT_EDGE: "1080" })).toBe(1080);
    expect(resolveDraftEdge({ KINO_DRAFT_EDGE: "off" })).toBe(null);
    expect(resolveDraftEdge({ KINO_DRAFT_EDGE: "full" })).toBe(null);
    expect(resolveDraftEdge({ KINO_DRAFT_EDGE: "0" })).toBe(null);
  });

  it("rejects a typo rather than silently rendering at some other size", () => {
    expect(() => resolveDraftEdge({ KINO_DRAFT_EDGE: "720p" })).toThrow(/pixel count/);
    expect(() => resolveDraftEdge({ KINO_DRAFT_EDGE: "32" })).toThrow(/pixel count/);
  });
});
