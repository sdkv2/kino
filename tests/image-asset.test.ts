import { describe, it, expect } from "vitest";
import { isRasterImagePath, prepareInlineSvg, sanitizeInlineSvg } from "../src/media/imageAsset.js";

describe("imageAsset", () => {
  it("accepts svg paths as raster images", () => {
    expect(isRasterImagePath("icons/star.svg")).toBe(true);
    expect(isRasterImagePath("icons/star.png")).toBe(true);
    expect(isRasterImagePath("icons/star.gif")).toBe(false);
  });

  it("strips script tags and on* handlers from inline svg", () => {
    const raw = '<svg onclick="alert(1)"><script>evil()</script><circle r="1"/></svg>';
    expect(sanitizeInlineSvg(raw)).not.toMatch(/script|onclick/i);
    expect(sanitizeInlineSvg(raw)).toMatch(/circle/);
  });

  it("wraps bare markup in an svg root", () => {
    const out = prepareInlineSvg('<circle cx="50" cy="50" r="40"/>');
    expect(out).toMatch(/^<svg[^>]*xmlns=/i);
    expect(out).toMatch(/<circle/);
  });
});
