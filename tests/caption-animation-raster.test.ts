// The other half of caption animations: the vars have to actually PAINT.
//
// captionAnimVars produces the numbers and captionMarkup produces the `var(--ka0-t, none)`
// declarations, and both are unit-tested in caption-animation.test.ts — but neither says anything
// about whether a custom property injected into `rasterAt`'s css argument reaches a style attribute
// inside a foreignObject SVG. That is the one link in the chain no pure test can reach, and the one
// whose failure mode is silent: an unresolvable var() takes the whole declaration with it, and an
// element with `opacity: <invalid>` simply does not appear.
//
// So this drives the real raster path — buildTemplate, then rasterAt with and without vars — and
// looks at pixels.
import { describe, it, expect, afterAll } from "vitest";
import { glProbe, closeGlHost } from "./helpers/glHost.js";

afterAll(closeGlHost);

/** Alpha coverage of a 64x64 raster of `html`, rasterized with `css` injected. */
function coverage(html: string, css: string): Promise<number> {
  return glProbe<[string, string], number>({
    entry: "src/render/native/page/bgTextures.ts",
    globalName: "KinoTex",
    html: `<!doctype html><body></body>`,
    fn: async (html: string, css: string) => {
      const K = (window as unknown as { KinoTex: Record<string, any> }).KinoTex;
      const theme = {
        font: "Arial", labelFont: "Arial", bg: "#000000", fg: "#ffffff",
        accent: "#80e2b4", accent2: "#d99a20", deep: "#0c8d64",
        captionFontSize: 40, captionStroke: 0,
      };
      const tpl = await K.buildTemplate(html, theme, { size: { w: 64, h: 64 }, scale: 1 });
      const canvas = await K.rasterAt(tpl, "probe", css, null);
      if (!canvas) return -1;
      const ctx = canvas.getContext("2d")!;
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let lit = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 8) lit++;
      return lit;
    },
    args: [html, css],
  });
}

// The exact shape captionMarkup emits for an animated word.
const WORD = (i: number) =>
  `<span class="kino-word-anim" style="display:inline-block;` +
  `transform:var(--ka${i}-t,none);opacity:var(--ka${i}-o,1);filter:var(--ka${i}-f,)">` +
  `<span style="color:#ffffff;font-family:Arial;font-size:40px">Xx</span></span>`;
const MARKUP = `<div style="position:absolute;inset:0">${WORD(0)}</div>`;
const vars = (decls: string) => `.kino-tex-root{${decls}}`;

describe("animated caption markup through the real raster", () => {
  it("paints at all with no vars set — the fallbacks are the settled pose", async () => {
    const lit = await coverage(MARKUP, "");
    expect(lit).toBeGreaterThan(0);
  }, 300000);

  it("hides the word when the entrance var says opacity 0", async () => {
    // The pre-entrance pose. If the custom property did not reach the style attribute this would
    // paint exactly as the settled one did.
    const lit = await coverage(MARKUP, vars("--ka0-t:scale(0.7);--ka0-o:0"));
    expect(lit).toBe(0);
  }, 300000);

  it("scales the word when the entrance var says so", async () => {
    const settled = await coverage(MARKUP, "");
    const small = await coverage(MARKUP, vars("--ka0-t:scale(0.4);--ka0-o:1"));
    expect(small).toBeGreaterThan(0);
    expect(small).toBeLessThan(settled);
  }, 300000);

  it("accepts the empty filter fallback — `var(--ka0-f,)` is a valid absent filter", async () => {
    // A `filter: none` beside another filter function is invalid CSS and would drop the paint;
    // this asserts the empty-fallback form does not.
    const withFilter = await coverage(MARKUP, vars("--ka0-o:1;--ka0-f:blur(3px)"));
    expect(withFilter).toBeGreaterThan(0);
  }, 300000);
});
