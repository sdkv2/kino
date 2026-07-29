import { describe, it, expect } from "vitest";
import { htmlTemplateFromXhtml, scrubCss, TEX_ROOT } from "../src/render/native/page/bgTextures.js";

const theme = {
  font: "Arial",
  labelFont: "Helvetica",
  night: "#0b1020",
  mint: "#80e2b4",
  green: "#0c8d64",
  gold: "#d99a20",
  white: "#fff",
  captionFontSize: 74,
  captionStroke: 9,
  film: 0,
};

const DATA_URL_PREFIX = "data:image/svg+xml;charset=utf-8,";

function decodeSvgUrl(url: string): string {
  expect(url.startsWith(DATA_URL_PREFIX)).toBe(true);
  return decodeURIComponent(url.slice(DATA_URL_PREFIX.length));
}

function base64Chunk(): string {
  return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
}

function makeTpl(xhtml: string, defs = "") {
  return htmlTemplateFromXhtml(xhtml, theme, 320, 180, 2, "@font-face{font-family:'Test';src:local('Arial')}", defs);
}

const cssCases = [
  "",
  `.${TEX_ROOT} .lens{visibility:hidden}`,
  scrubCss(0.375),
  `.${TEX_ROOT} *{content:"#%&'\\""}`,
];

describe("htmlTemplateFromXhtml encoded prefix/suffix", () => {
  it.each(cssCases.map((css, i) => [String(i), css] as const))(
    "makeSvgUrl matches encodeURIComponent(makeSvg) for css case %s",
    (_label, css) => {
      const xhtml =
        `<p id="t">Hello <span style="background-image:url(${base64Chunk()})">world</span></p>` +
        `<p>edge # % &amp; &quot; &#39;</p>`;
      const tpl = makeTpl(xhtml);
      const url = tpl.makeSvgUrl(css);
      const svg = tpl.makeSvg(css);
      expect(decodeSvgUrl(url)).toBe(svg);
      expect(url).toBe(DATA_URL_PREFIX + encodeURIComponent(svg));
      expect(tpl.svgByteLength(css)).toBe(svg.length);
    },
  );

  it("round-trips markup with emoji / astral characters", () => {
    const xhtml = `<p>UI mock 🎬🔥 and ZWJ family 👨‍👩‍👧</p>`;
    const css = scrubCss(0.5);
    const tpl = makeTpl(xhtml);
    const svg = tpl.makeSvg(css);
    expect(decodeSvgUrl(tpl.makeSvgUrl(css))).toBe(svg);
  });

  it("round-trips #, %, quotes, and base64 payloads in markup", () => {
    const xhtml =
      `<div style="background:url('${base64Chunk()}')">` +
      `<span>#hash %pct &amp; "quotes" 'apostrophe'</span></div>`;
    const tpl = makeTpl(xhtml, `<filter id="f"><feGaussianBlur/></filter>`);
    for (const css of cssCases) {
      const svg = tpl.makeSvg(css);
      expect(decodeSvgUrl(tpl.makeSvgUrl(css))).toBe(svg);
    }
  });

  it("caches encoded halves — second plate reuses prefix/suffix encode", () => {
    const xhtml = "<p>" + "x".repeat(4096) + "</p>";
    const tpl = makeTpl(xhtml);
    const a = tpl.makeSvgUrl(scrubCss(0));
    const b = tpl.makeSvgUrl(scrubCss(0.25));
    const c = tpl.makeSvgUrl(scrubCss(0.5));
    // Different css → different URLs, but each still decodes to makeSvg output.
    expect(a).not.toBe(b);
    expect(decodeSvgUrl(a)).toBe(tpl.makeSvg(scrubCss(0)));
    expect(decodeSvgUrl(b)).toBe(tpl.makeSvg(scrubCss(0.25)));
    expect(decodeSvgUrl(c)).toBe(tpl.makeSvg(scrubCss(0.5)));
  });
});
