import { describe, it, expect } from "vitest";
import { renderStills } from "../src/render/render.js";
import { execSync } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KinoProps } from "../src/render/props.js";

// Windows headless Chrome renders .kino-pulse/.kino-rise fully visible before their trigger
// (magentaFraction ~1.0 where mac/linux give ~0), and DirectWrite AA shifts the cliptext
// glyph-edge threshold. Skipped there until the trigger scrub is debugged on win32.
const isWin = process.platform === "win32";

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
  it.skipIf(isWin)("restores the trailing glyph edge that background-clip:text would otherwise cut", async () => {
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

const greenOf = (s: string) => {
  const m = s.match(/srgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!m) throw new Error(`Unexpected pixel format: ${s}`);
  return Number(m[2]);
};

describe("motion graphics procedural (Tier 2)", () => {
  it("renders a procedural graphic driven by env.progress, deterministically", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "kino-proc-"));
    // full-frame block whose green channel = round(progress*255); sampling the centre reads progress.
    const proc = "return `<div style=\"position:absolute;inset:0;background:rgb(0,${Math.round(env.progress*255)},0)\"></div>`;";
    const props: KinoProps = {
      theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null, background: bg, disclosure: "test",
      segments: [{ kind: "motion", caption: "", startSec: 0, endSec: 2,
        motion: { html: "", proc, params: {}, keyframes: [], triggers: [] } }],
    };
    // beat 0..2s = 60 frames; frame 6 → ~10% (dark green), frame 54 → ~90% (bright green).
    const outs = await renderStills({ props, publicDir: mkdtempSync(join(tmpdir(), "proc-pub-")), format: "9:16",
      frames: [{ frame: 6, name: "p-early" }, { frame: 54, name: "p-late" }, { frame: 54, name: "p-late2" }], outDir });
    const early = sampleCenter(outs[0]);
    const late = sampleCenter(outs[1]);
    const late2 = sampleCenter(outs[2]);
    expect(early).not.toBe(late);          // env.progress advanced the generated colour
    expect(late).toBe(late2);              // same frame twice → identical (deterministic)
    expect(greenOf(early)).toBeLessThan(80);     // ~10%
    expect(greenOf(late)).toBeGreaterThan(180);  // ~90%
  }, 180000);

  it("exposes env.durationFrames/env.duration (beat length) to the proc render", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "kino-procdur-"));
    // full-frame block whose green channel = durationFrames; 0..2s beat @30fps = 60 frames.
    const proc = "return `<div style=\"position:absolute;inset:0;background:rgb(0,${env.durationFrames},0)\"></div>`;";
    const props: KinoProps = {
      theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null, background: bg, disclosure: "test",
      segments: [{ kind: "motion", caption: "", startSec: 0, endSec: 2,
        motion: { html: "", proc, params: {}, keyframes: [], triggers: [] } }],
    };
    const outs = await renderStills({ props, publicDir: mkdtempSync(join(tmpdir(), "procdur-pub-")), format: "9:16",
      frames: [{ frame: 6, name: "dur" }], outDir });
    expect(greenOf(sampleCenter(outs[0]))).toBe(60); // env.duration = 60/30 = 2s, matches the 2s beat
  }, 180000);

  it("renders a blank frame (no crash) when render(env) throws", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "kino-procerr-"));
    const props: KinoProps = {
      theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null, background: bg, disclosure: "test",
      segments: [{ kind: "motion", caption: "", startSec: 0, endSec: 2,
        motion: { html: "", proc: "throw new Error('boom');", params: {}, keyframes: [], triggers: [] } }],
    };
    const outs = await renderStills({ props, publicDir: mkdtempSync(join(tmpdir(), "procerr-pub-")), format: "9:16", frames: [{ frame: 30, name: "err" }], outDir });
    expect(existsSync(outs[0])).toBe(true);
  }, 180000);

  it("disables CSS transitions so markup can't animate on the wall clock", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "kino-trans-"));
    // opacity bound to --progress with a long transition; transition:none must snap it to the frame's
    // value, so the same frame rendered twice is identical.
    const html = `<style>.b{position:absolute;inset:0;background:#00ff00;opacity:var(--progress);transition:opacity 10s linear}</style><div class="b"></div>`;
    const props: KinoProps = {
      theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null, background: bg, disclosure: "test",
      segments: [{ kind: "motion", caption: "", startSec: 0, endSec: 2,
        motion: { html, params: {}, keyframes: [], triggers: [] } }],
    };
    const outs = await renderStills({ props, publicDir: mkdtempSync(join(tmpdir(), "trans-pub-")), format: "9:16",
      frames: [{ frame: 40, name: "tr" }, { frame: 40, name: "tr2" }], outDir });
    expect(sampleCenter(outs[0])).toBe(sampleCenter(outs[1]));
  }, 180000);
});

describe("motion graphics CSS helper kit", () => {
  const mkMotion = (html: string, triggers: { at: number; action: string }[] = []): KinoProps => ({
    theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null, background: bg, disclosure: "test",
    segments: [{ kind: "motion", caption: "", startSec: 0, endSec: 2,
      motion: { html, params: {}, keyframes: [], triggers } }],
  });

  it.skipIf(isWin)(".kino-pulse pops on a trigger (action:pulse) and is hidden before it, deterministically", async () => {
    // Full-frame magenta box opacity/scale-driven by --pulse. Trigger at 0.5s (frame 15): hidden at
    // frame 6 (pulse 0), shown at frame 16 (pulse ~1). Magenta is absent from the glow background.
    const html = `<style>.b{position:absolute;inset:0;background:#ff00ff}</style><div class="b kino-pulse"></div>`;
    const outs = await renderStills({
      props: mkMotion(html, [{ at: 0.5, action: "pulse" }]),
      publicDir: mkdtempSync(join(tmpdir(), "pulse-pub-")), format: "9:16",
      frames: [{ frame: 6, name: "pre" }, { frame: 16, name: "on" }, { frame: 16, name: "on2" }],
      outDir: mkdtempSync(join(tmpdir(), "kino-pulse-")),
    });
    expect(magentaFraction(outs[0])).toBeLessThan(0.05);    // before the trigger → --pulse 0 → hidden
    expect(magentaFraction(outs[1])).toBeGreaterThan(0.5);  // on the trigger → --pulse ~1 → popped on
    expect(sampleCenter(outs[1])).toBe(sampleCenter(outs[2])); // same frame twice → identical
  }, 180000);

  it.skipIf(isWin)(".kino-rise reveals across the beat and holds, deterministically", async () => {
    // Reveal completes by ~35% of the beat then holds: hidden at frame 0 (opacity 0), shown by frame 50.
    const html = `<style>.b{position:absolute;inset:0;background:#ff00ff}</style><div class="b kino-rise"></div>`;
    const outs = await renderStills({
      props: mkMotion(html),
      publicDir: mkdtempSync(join(tmpdir(), "rise-pub-")), format: "9:16",
      frames: [{ frame: 0, name: "start" }, { frame: 50, name: "held" }, { frame: 50, name: "held2" }],
      outDir: mkdtempSync(join(tmpdir(), "kino-rise-")),
    });
    expect(magentaFraction(outs[0])).toBeLessThan(0.05);    // start of beat → opacity 0 → hidden
    expect(magentaFraction(outs[1])).toBeGreaterThan(0.5);  // past ~35% → revealed + held
    expect(sampleCenter(outs[1])).toBe(sampleCenter(outs[2])); // deterministic
  }, 180000);
});

const brightnessOf = (s: string) => {
  const m = s.match(/srgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!m) throw new Error(`Unexpected pixel format: ${s}`);
  return (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3;
};
const sampleAt = (png: string, x: number, y: number) =>
  execSync(`magick "${png}" -format "%[pixel:p{${x},${y}}]" info:`).toString().trim();
const stddev = (png: string) => parseFloat(execSync(`magick "${png}" -format "%[fx:standard_deviation]" info:`).toString().trim());

describe("motion graphics SVG texture library", () => {
  const mkMotion = (html: string, disclosure = "test"): KinoProps => ({
    theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null, background: bg, disclosure,
    segments: [{ kind: "motion", caption: "", startSec: 0, endSec: 2,
      motion: { html, params: {}, keyframes: [], triggers: [] } }],
  });

  it(".kino-vignette darkens the edges and keeps the centre bright", async () => {
    // Full-frame white under a vignette overlay: centre stays ~white, a near-corner is clearly darker.
    const html = `<style>.w{position:absolute;inset:0;background:#ffffff}</style><div class="w"></div><div class="kino-vignette"></div>`;
    const outs = await renderStills({ props: mkMotion(html), publicDir: mkdtempSync(join(tmpdir(), "vig-pub-")),
      format: "9:16", frames: [{ frame: 20, name: "v" }], outDir: mkdtempSync(join(tmpdir(), "kino-vig-")) });
    const centre = brightnessOf(sampleAt(outs[0], 540, 960));
    const corner = brightnessOf(sampleAt(outs[0], 70, 130));
    expect(centre).toBeGreaterThan(230);        // centre ~white
    expect(corner).toBeLessThan(centre - 40);   // corner visibly darkened by the vignette
  }, 180000);

  it(".kino-grain adds seeded texture and is deterministic", async () => {
    // A flat mid-grey field: plain is ~uniform (std-dev ≈ 0); with grain its variance rises. feTurbulence
    // is seeded, so the same frame rendered twice is byte-identical.
    const grey = `<style>.g{position:absolute;inset:0;background:#808080}</style><div class="g"></div>`;
    const grained = grey + `<div class="kino-grain"></div>`;
    const plainOut = await renderStills({ props: mkMotion(grey, ""), publicDir: mkdtempSync(join(tmpdir(), "plain-pub-")),
      format: "9:16", frames: [{ frame: 20, name: "p" }], outDir: mkdtempSync(join(tmpdir(), "kino-plain-")) });
    const grainOut = await renderStills({ props: mkMotion(grained, ""), publicDir: mkdtempSync(join(tmpdir(), "grain-pub-")),
      format: "9:16", frames: [{ frame: 20, name: "g1" }, { frame: 20, name: "g2" }], outDir: mkdtempSync(join(tmpdir(), "kino-grain-")) });
    expect(stddev(plainOut[0])).toBeLessThan(0.01);            // flat field
    expect(stddev(grainOut[0])).toBeGreaterThan(stddev(plainOut[0]) + 0.01); // grain adds texture
    expect(sampleAt(grainOut[0], 300, 700)).toBe(sampleAt(grainOut[1], 300, 700)); // deterministic (seeded)
  }, 180000);
});
