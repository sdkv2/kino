import { describe, it, expect } from "vitest";
import { renderStills } from "../src/render/render.js";
import { execSync } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KinoProps } from "../src/render/props.js";

const theme = { font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64", gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9 };
const bg = { kind: "glow" as const, image: null, customCode: null, params: { colorA: "#80e2b4", colorB: "#0c8d64", colorC: "#d99a20", intensity: 0.5 }, keyframes: [], triggers: [] };
const html = `<style>.bar{position:absolute;left:10%;bottom:20%;height:40px;width:calc(var(--pct)*1%);background:var(--kino-mint)}</style><div class="bar"></div>`;

describe("motion graphics render", () => {
  it("renders a still of a motion segment (CSS-variable bar)", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "kino-mgr-"));
    const props: KinoProps = {
      theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null, background: bg,
      disclosure: "test",
      segments: [
        { kind: "motion", caption: "", startSec: 0, endSec: 2,
          motion: { html, params: { pct: 0 }, keyframes: [{ at: 0.2, params: { pct: 86 } }], triggers: [] } },
      ],
    };
    const outs = await renderStills({ props, publicDir: outDir, format: "9:16", frames: [{ frame: 30, name: "mg" }], outDir });
    expect(outs).toHaveLength(1);
    expect(existsSync(outs[0]) && outs[0].endsWith(".png")).toBe(true);
  }, 180000);

  it("renders a motionOverlay on an avatar beat", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "kino-mgo-"));
    const props: KinoProps = {
      theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null, background: bg,
      disclosure: "test",
      segments: [
        { kind: "avatar", caption: "hook", startSec: 0, endSec: 2,
          motionOverlay: { html, params: { pct: 50 }, keyframes: [], triggers: [] } },
      ],
    };
    const outs = await renderStills({ props, publicDir: outDir, format: "9:16", frames: [{ frame: 20, name: "ov" }], outDir });
    expect(outs).toHaveLength(1);
    expect(existsSync(outs[0])).toBe(true);
  }, 180000);
});

const sampleCenter = (png: string) => execSync(`magick "${png}" -format "%[pixel:p{540,960}]" info:`).toString().trim();

describe("motion graphics @keyframes scrub", () => {
  it("scrubs a .kino-anim @keyframes across the beat, deterministically", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "kino-scrub-"));
    // opaque full-frame background fading #000 → #0f0 over the animation; sampling the centre pixel
    // tells us where the scrub is. .kino-anim makes kino pause + scrub it by --progress.
    const scrubHtml = `<style>@keyframes fade{from{background:#000000}to{background:#00ff00}} .bg{position:absolute;inset:0;animation-name:fade}</style><div class="bg kino-anim"></div>`;
    const props: KinoProps = {
      theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null, background: bg,
      disclosure: "test",
      segments: [{ kind: "motion", caption: "", startSec: 0, endSec: 2,
        motion: { html: scrubHtml, params: {}, keyframes: [], triggers: [] } }],
    };
    // beat 0..2s = 60 frames; --progress ≈ localFrame/60. frame 6 → ~10% (dark), frame 54 → ~90% (green).
    const outs = await renderStills({ props, publicDir: outDir, format: "9:16",
      frames: [{ frame: 6, name: "early" }, { frame: 54, name: "late" }, { frame: 54, name: "late2" }], outDir });
    const early = sampleCenter(outs[0]);
    const late = sampleCenter(outs[1]);
    const late2 = sampleCenter(outs[2]);
    expect(early).not.toBe(late); // the paused animation is scrubbed forward across the beat
    expect(late).toBe(late2);     // same frame twice → identical pixels (deterministic)
    // strengthen: assertions that can only hold when the scrub actually advances the #000→#0f0 fade
    // (a backdrop fallback would carry blue/red from the mint glow and fail these).
    const parse = (s: string) => {
      const m = s.match(/srgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      if (!m) throw new Error(`Unexpected pixel format: ${s}`);
      return { r: +m[1], g: +m[2], b: +m[3] };
    };
    const earlyPx = parse(early);
    const latePx = parse(late);
    // early (~10% into the fade): dark
    expect(earlyPx.g).toBeLessThan(100);
    expect(earlyPx.r).toBeLessThan(80);
    expect(earlyPx.b).toBeLessThan(80);
    // late (~90% into the fade): green-dominant
    expect(latePx.g).toBeGreaterThan(200);
    expect(latePx.r).toBeLessThan(80);
    expect(latePx.b).toBeLessThan(80);
  }, 180000);
});

// fraction of the frame that is (near-)magenta — magenta is absent from the glow background, so this
// measures the gradient-clipped glyph's painted area. ImageMagick: magenta→white, everything else→black.
const magentaFraction = (png: string) =>
  parseFloat(
    execSync(`magick "${png}" -fuzz 28% -fill white -opaque '#ff00ff' -fuzz 0 -fill black +opaque white -format "%[fx:mean]" info:`)
      .toString()
      .trim(),
  );

describe("motion graphics kino-cliptext helper", () => {
  it("restores the trailing glyph edge that background-clip:text would otherwise cut", async () => {
    // A shrink-wrapped, gradient-clipped glyph with tight negative letter-spacing: the box ends up
    // narrower than the ink, so the right of the "8" has no gradient behind it → transparent (cut).
    // class="kino-cliptext" widens the paint box so that ink keeps its gradient. Solid magenta so it
    // stands out from the mint/green/gold glow background.
    const make = (cls: string) =>
      `<style>.wrap{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}` +
      `.t{font-family:var(--kino-font);font-weight:900;font-size:620px;letter-spacing:-.12em;` +
      `background-image:linear-gradient(#ff00ff,#ff00ff);-webkit-background-clip:text;background-clip:text;color:transparent}</style>` +
      `<div class="wrap"><div class="t ${cls}">8</div></div>`;
    const mkProps = (html: string): KinoProps => ({
      theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null, background: bg, disclosure: "test",
      segments: [{ kind: "motion", caption: "", startSec: 0, endSec: 2, motion: { html, params: {}, keyframes: [], triggers: [] } }],
    });
    const outDir = mkdtempSync(join(tmpdir(), "kino-clip-"));
    const off = await renderStills({ props: mkProps(make("")), publicDir: mkdtempSync(join(tmpdir(), "clip-a-")), format: "9:16", frames: [{ frame: 30, name: "off" }], outDir });
    const on = await renderStills({ props: mkProps(make("kino-cliptext")), publicDir: mkdtempSync(join(tmpdir(), "clip-b-")), format: "9:16", frames: [{ frame: 30, name: "on" }], outDir });
    const magOff = magentaFraction(off[0]);
    const magOn = magentaFraction(on[0]);
    expect(magOff).toBeGreaterThan(0);     // a magenta "8" did render in both
    expect(magOn).toBeGreaterThan(magOff); // the helper paints the previously-clipped right edge → strictly more magenta
  }, 180000);
});

describe("empty disclosure", () => {
  it("renders a still with no disclosure text without crashing", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "kino-nodisc-"));
    const props: KinoProps = {
      theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null, background: bg,
      disclosure: "",
      segments: [{ kind: "motion", caption: "", startSec: 0, endSec: 2,
        motion: { html: `<div style="position:absolute;inset:0;background:#001"></div>`, params: {}, keyframes: [], triggers: [] } }],
    };
    const outs = await renderStills({ props, publicDir: mkdtempSync(join(tmpdir(), "nodisc-pub-")), format: "9:16", frames: [{ frame: 20, name: "nd" }], outDir });
    expect(existsSync(outs[0])).toBe(true);
  }, 180000);
});
