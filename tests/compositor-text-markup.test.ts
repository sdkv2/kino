import { describe, it, expect } from "vitest";
import { captionMarkup, kickerMarkup, disclosureMarkup } from "../src/render/native/page/compositor/textMarkup.js";

const theme = {
  font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64",
  gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9,
};

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
});

describe("kickerMarkup", () => {
  it("uses the kicker's own colors, not the theme's", () => {
    const html = kickerMarkup({ text: "NEW", color: "#ff0000", fg: "#00ff00", theme });
    expect(html).toContain("#ff0000");
    expect(html).toContain("#00ff00");
  });
});

describe("disclosureMarkup", () => {
  it("renders the disclosure text", () => {
    expect(disclosureMarkup({ text: "AI generated", theme })).toContain("AI generated");
  });
});
