import { describe, it, expect } from "vitest";
import { needsMotionDefs } from "../src/render/native/page/motionRaster.js";

describe("needsMotionDefs", () => {
  it("matches the CSS property form", () => {
    expect(needsMotionDefs('<div style="filter:url(#kino-displace)"></div>')).toBe(true);
    expect(needsMotionDefs("<style>.a{filter: url(#kino-grain)}</style>")).toBe(true);
  });

  it("matches the SVG presentation-attribute form", () => {
    // The regression: only the CSS form was matched, so the defs were never injected and an SVG
    // reference resolved to nothing — the element rendered completely unfiltered, with no error.
    expect(needsMotionDefs('<svg><text filter="url(#kino-rgb)">S</text></svg>')).toBe(true);
    expect(needsMotionDefs("<svg><g filter='url(#kino-smear-x-lg)'></g></svg>")).toBe(true);
    expect(needsMotionDefs('<svg><g filter = "url( #kino-displace )"></g></svg>')).toBe(true);
  });

  it("still matches the helper classes", () => {
    expect(needsMotionDefs('<div class="kino-grain"></div>')).toBe(true);
    expect(needsMotionDefs('<div class="kino-vignette"></div>')).toBe(true);
  });

  it("stays false for a page that references no kino def", () => {
    expect(needsMotionDefs('<div style="filter:blur(3px)"></div>')).toBe(false);
    expect(needsMotionDefs('<svg><text filter="url(#mine)">S</text></svg>')).toBe(false);
    expect(needsMotionDefs("<div>plain</div>")).toBe(false);
  });
});
