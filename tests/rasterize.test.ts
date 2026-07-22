import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { screenDigest, layerDigest, rasterizeScreen, rasterizeLayer, SCREEN_W, SCREEN_H } from "../src/render/scene/rasterize.js";
import { KINO_SCRUB_STYLE, KINO_DEFS } from "../src/render/motionCss.js";
import { resolveExecutable } from "../src/render/native/browser.js";

const RASTER_V = 1;

const theme = { font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64", gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9 };
const base = {
  html: `<div style="color:var(--kino-mint);opacity:var(--progress)">hi</div>`,
  words: [{ word: "hi", start: 0, end: 0.4 }],
  theme, params: {}, keyframes: [], triggers: [], fps: 30, durationFrames: 3,
};

describe("digests (pure)", () => {
  it("screenDigest is stable and content-sensitive", () => {
    expect(screenDigest(base)).toBe(screenDigest({ ...base }));
    expect(screenDigest(base)).not.toBe(screenDigest({ ...base, html: base.html + " " }));
    expect(screenDigest(base)).not.toBe(screenDigest({ ...base, durationFrames: 4 }));
    expect(screenDigest(base)).not.toBe(screenDigest({ ...base, words: [] }));
  });
  it("layerDigest is stable and content-sensitive", () => {
    const svg = `<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>`;
    expect(layerDigest(svg)).toBe(layerDigest(svg));
    expect(layerDigest(svg)).not.toBe(layerDigest(svg + " "));
  });
  it("screenDigest includes motionCss bytes (cache busts on KINO_SCRUB_STYLE/KINO_DEFS change)", () => {
    const d = screenDigest(base);
    const manual = createHash("sha1")
      .update(
        JSON.stringify([
          RASTER_V,
          SCREEN_W,
          SCREEN_H,
          KINO_SCRUB_STYLE,
          KINO_DEFS,
          base.html,
          base.words,
          base.theme,
          base.params,
          base.keyframes,
          base.triggers,
          base.fps,
          base.durationFrames,
        ]),
      )
      .digest("hex");
    expect(d).toBe(manual);
    expect(d).toBe(screenDigest({ ...base })); // stable with current motionCss constants
  });
});

const chrome = await resolveExecutable();
if (!chrome) console.warn("rasterize browser tests SKIPPED — no Chrome found");
const maybe = chrome ? describe : describe.skip;

maybe("rasterize (Chrome)", () => {
  it("rasterizeScreen writes one PNG per frame at screen resolution", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-scr-"));
    await rasterizeScreen({ ...base, outDir: dir });
    const files = readdirSync(dir).filter((f) => /^f\d{5}\.png$/.test(f)).sort();
    expect(files).toEqual(["f00001.png", "f00002.png", "f00003.png"]);
  }, 60000);

  it("rasterizeLayer writes an alpha PNG", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-lay-"));
    const out = join(dir, "logo.png");
    await rasterizeLayer({ svg: `<svg viewBox="0 0 100 50"><circle cx="50" cy="25" r="20" fill="red"/></svg>`, outPath: out });
    expect(existsSync(out)).toBe(true);
  }, 60000);
});
