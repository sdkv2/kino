import { describe, it, expect } from "vitest";
import { CAPTION_BOTTOM, captionBandBottom, isHeroCaption } from "../src/render/captionLayout.js";
import type { KinoSegment } from "../src/render/props.js";

const seg = (o: Partial<KinoSegment>): KinoSegment => ({ kind: "motion", caption: "", startSec: 0, endSec: 2, ...o });

describe("captionBandBottom", () => {
  it("returns the caption band bottom for a motion beat with a caption", () => {
    expect(captionBandBottom(seg({ caption: "hello" }), false)).toBe(CAPTION_BOTTOM);
  });
  it("returns 0 for a beat with no caption text and no words (nothing reserves the band)", () => {
    expect(captionBandBottom(seg({ caption: "" }), false)).toBe(0);
    expect(captionBandBottom(seg({ caption: "   " }), false)).toBe(0);
  });
  it("returns the band for a word-synced beat even when caption text is empty", () => {
    const s = seg({ caption: "", captionMode: "words", words: [{ word: "hi", start: 0, end: 0.3 }] });
    expect(captionBandBottom(s, false)).toBe(CAPTION_BOTTOM);
  });
  it("returns 0 for a faceless avatar beat (hero caption is centered, not in the bottom band)", () => {
    expect(captionBandBottom(seg({ kind: "avatar", caption: "hook" }), false)).toBe(0);
  });
  it("returns 0 for a faceless CTA beat (end card is hero-centered, not lower-third)", () => {
    expect(captionBandBottom(seg({ kind: "avatar", caption: "download free", cta: true }), false)).toBe(0);
  });
  it("returns the band for an app beat with a caption", () => {
    expect(captionBandBottom(seg({ kind: "app", asset: "x.png", caption: "look" }), true)).toBe(CAPTION_BOTTOM);
  });
});

describe("isHeroCaption", () => {
  it("is true for all faceless avatar beats (hooks and CTA end cards)", () => {
    expect(isHeroCaption({ kind: "avatar" }, false)).toBe(true);
    expect(isHeroCaption({ kind: "avatar", cta: true }, false)).toBe(true);
    expect(isHeroCaption({ kind: "avatar" }, true)).toBe(false);
    expect(isHeroCaption({ kind: "app" }, false)).toBe(false);
  });
});
