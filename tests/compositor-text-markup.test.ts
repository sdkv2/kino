import { describe, it, expect } from "vitest";
import { captionMarkup, kickerMarkup, disclosureMarkup, textMarkup, cssText } from "../src/render/native/page/compositor/textMarkup.js";
import type { Theme } from "../src/render/props.js";
import type { ResolvedText } from "../src/render/textStyles.js";

const theme: Theme = {
  font: "Arial", bg: "#0b1020", accent: "#80e2b4", deep: "#0c8d64",
  accent2: "#d99a20", fg: "#fff", captionFontSize: 74, captionStroke: 9,
};

const words = [
  { word: "ship", start: 0, end: 0.3 },
  { word: "it", start: 0.3, end: 0.5 },
  { word: "fast", start: 0.5, end: 0.8 },
];

describe("cssText", () => {
  it("kebab-cases properties, px-suffixes numbers, keeps unitless font-weight", () => {
    expect(cssText({ borderRadius: 6, fontWeight: 900, WebkitTextStroke: "9px #000" }))
      .toBe("border-radius:6px;font-weight:900;-webkit-text-stroke:9px #000");
  });
});

describe("captionMarkup", () => {
  it("renders the caption text", () => {
    expect(captionMarkup({ text: "ship it", theme, hero: false, activeWord: null })).toContain("ship it");
  });

  it("applies the theme's caption size and stroke", () => {
    const html = captionMarkup({ text: "ship it", theme, hero: false, activeWord: null });
    expect(html).toContain("74px");
    expect(html).toContain("9px");
  });

  it("marks the active word for words-mode reveal", () => {
    const html = captionMarkup({ text: "ship it fast", theme, hero: false, activeWord: 1 });
    expect(html).toMatch(/class="[^"]*kino-word-active/);
  });

  it("escapes markup in caption text so a spec cannot inject elements", () => {
    expect(captionMarkup({ text: `<img src=x onerror=1>`, theme, hero: false, activeWord: null }))
      .not.toContain("<img");
  });

  it("derives the stroke halo from the ink (no hardcoded #000 blob on light schemes)", () => {
    const light: Theme = { ...theme, fg: "#111111" };
    const html = captionMarkup({ text: "ship it", theme: light, hero: false, activeWord: null });
    expect(html).toContain("-webkit-text-stroke:9px #fff");
  });

  it("paints the highlight style's boxed active word instead of the stroke look", () => {
    const html = captionMarkup({ text: "", words, tAbs: 0.4, theme, hero: false, activeWord: 1, style: "highlight" });
    expect(html).toContain(`background-color:${theme.accent}`); // active word box
    expect(html).not.toContain("-webkit-text-stroke");
  });

  it("paints the gradient style's clipped fill", () => {
    const html = captionMarkup({ text: "ship it", theme, hero: false, activeWord: null, style: "gradient" });
    expect(html).toContain("-webkit-background-clip:text");
    expect(html).toContain(theme.deep);
  });

  it("keeps minimal style stroke-free at weight 700", () => {
    const html = captionMarkup({ text: "ship it", theme, hero: false, activeWord: null, style: "minimal" });
    expect(html).toContain("font-weight:700");
    expect(html).not.toContain("-webkit-text-stroke");
  });

  it("hides unspoken words with reveal 'word' and shows them with reveal 'all'", () => {
    const perWord = captionMarkup({ text: "", words, tAbs: 0.1, theme, hero: false, activeWord: 0 });
    expect(perWord).toContain("opacity:0");
    const all = captionMarkup({ text: "", words, tAbs: 0.1, theme, hero: false, activeWord: 0, reveal: "all" });
    expect(all).not.toContain("opacity:0");
  });

  it("lays out the whole hero line with reveal 'all' even before later words are spoken", () => {
    const perWord = captionMarkup({ text: "", words, tAbs: 0.1, theme, hero: true, activeWord: 0 });
    expect(perWord).toContain("opacity:0");
    const all = captionMarkup({ text: "", words, tAbs: 0.1, theme, hero: true, activeWord: 0, reveal: "all" });
    expect(all).not.toContain("opacity:0");
  });

  it("plates the lower-third row with the configured backplate", () => {
    const html = captionMarkup({ text: "ship it", theme, hero: false, activeWord: null, backplate: { bg: "#0b1020d1" } });
    expect(html).toContain("background-color:#0b1020d1");
  });

  it("accents the brand name wherever it is spoken", () => {
    const branded: Theme = { ...theme, brandName: "ship" };
    const html = captionMarkup({ text: "", words, tAbs: 0.6, theme: branded, hero: false, activeWord: 2 });
    expect(html).toContain(`color:${theme.accent};font-weight:900`); // "ship" highlighted while "fast" is active
  });
});

describe("kickerMarkup", () => {
  it("uses the kicker's own colors, not the theme's", () => {
    const html = kickerMarkup({ text: "NEW", color: "#ff0000", fg: "#00ff00", theme });
    expect(html).toContain("#ff0000");
    expect(html).toContain("#00ff00");
  });
});

describe("textMarkup", () => {
  const overlay: ResolvedText = { text: "Big claim", fromSec: 0, durSec: 1, x: 50, y: 45, sizePx: 74, style: "stroke", animation: "pop" };

  it("styles the overlay with its resolved look preset", () => {
    const html = textMarkup({ overlay, theme });
    expect(html).toContain("-webkit-text-stroke");
    const grad = textMarkup({ overlay: { ...overlay, style: "gradient" }, theme });
    expect(grad).toContain("-webkit-background-clip:text");
  });
});

describe("disclosureMarkup", () => {
  it("renders the disclosure text", () => {
    expect(disclosureMarkup({ text: "AI generated", theme })).toContain("AI generated");
  });
});
