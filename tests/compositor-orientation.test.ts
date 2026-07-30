import { describe, it, expect, afterAll } from "vitest";
import { renderStills } from "../src/render/render.js";
import { magick } from "./magick.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KinoProps } from "../src/render/props.js";

// Two independent markers, at different heights, so a vertical mirror cannot be mistaken for a
// correct render: the backdrop paints a RED band across the top eighth, and the motion raster a
// GREEN band a quarter of the way down. A flip sends each to a different (and wrong) band.
const theme = {
  font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64",
  gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9, film: 0,
};
const bg = {
  kind: "custom" as const, image: null, shaderCode: null,
  customCode:
    "const c=ctx.canvas;ctx.fillStyle='#000';ctx.fillRect(0,0,c.width,c.height);" +
    "ctx.fillStyle='#ff0000';ctx.fillRect(0,0,c.width,c.height*0.125);",
  params: {}, keyframes: [], triggers: [],
};

const motionHtml = (extraStyle = "") =>
  `<style>.bar{position:absolute;left:0;right:0;top:480px;height:240px;background:#00ff00;${extraStyle}}</style><div class="bar"></div>`;

/** A caption alongside the motion makes the beat group multi-layer, which routes the group
 *  through the offscreen-target blit — the path that used to mirror it. */
const propsFor = (opts: { effect?: boolean } = {}): KinoProps =>
  ({
    theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null,
    background: bg, disclosure: "",
    segments: [{
      kind: "motion",
      caption: "CAP",
      startSec: 0,
      endSec: 2,
      motion: { html: motionHtml(), params: {}, keyframes: [], triggers: [] },
      ...(opts.effect ? { effects: [{ kind: "glow", params: { radius: 4, intensity: 0.6 } }] } : {}),
    }],
  }) as KinoProps;

const band = (png: string, y: number, channel: "r" | "g") =>
  parseFloat(
    magick([png, "-crop", `1080x240+0+${y}`, "+repage", "-format", `%[fx:mean.${channel}]`, "info:"]).trim(),
  );

/** Mean channel over a small patch. Two reasons a full-width 240-row `band` cannot see a blur:
 *  blurring a large solid rectangle only softens its EDGES (the interior stays saturated), and a
 *  RADIAL focal region is a circle about the frame centre, so the bar's far ends are legitimately
 *  out of focus however the y axis is oriented. Sampling a narrow patch just outside an edge, in
 *  the horizontal middle where the focal circle actually sits, isolates the axis under test. */
const patch = (png: string, x: number, y: number, w: number, h: number, channel: "r" | "g") =>
  parseFloat(
    magick([png, "-crop", `${w}x${h}+${x}+${y}`, "+repage", "-format", `%[fx:mean.${channel}]`, "info:"]).trim(),
  );

const render = async (props: KinoProps, ss: string) => {
  process.env.KINO_SHADER_SSAA = ss;
  const [png] = await renderStills({
    props,
    publicDir: mkdtempSync(join(tmpdir(), "orient-pub-")),
    format: "9:16",
    frames: [{ frame: 10, name: "o" }],
    outDir: mkdtempSync(join(tmpdir(), "kino-orient-")),
  });
  return png!;
};

const prevSS = process.env.KINO_SHADER_SSAA;
afterAll(() => {
  if (prevSS === undefined) delete process.env.KINO_SHADER_SSAA;
  else process.env.KINO_SHADER_SSAA = prevSS;
});

// WHY SS=2 RUNS ONE TEST, NOT ALL THREE.
//
// This file used to run its whole body at both supersample factors: 8 renders, 4 of them at SS=2
// and therefore 4x the pixels, which made it the single most expensive file in the suite (~180s,
// roughly a fifth of the GPU scope).
//
// Orientation is a property of the OFFSCREEN-TARGET BLIT, and the supersample factor changes that
// target — a mirror could be introduced in the downsample step at SS=2 alone. So SS=2 keeps the
// test that would see exactly that: the plain upright check, whose two independent markers at
// different heights are what makes a flip unmistakable.
//
// What SS=2 does NOT need to re-prove is orientation through the effect chain and through
// defocus(): those two ask whether a filtered layer and a focal axis are right-way-up, and neither
// claim is supersample-dependent. Their SS-sensitivity is a measurement detail the focusY test
// already handles by asserting a RATIO rather than a level (see its note below). Everything else
// about SS=2 — antialiasing and determinism — is compositor-ss.test.ts's job, not this file's.
const SS_ALL = ["1", "2"];
const SS_ORIENTATION_ONLY = ["1"];

describe("compositor orientation", () => {
  for (const ss of SS_ALL) {
    it(`keeps backdrop and motion rasters upright at SS=${ss}`, async () => {
      const png = await render(propsFor(), ss);
      // Backdrop red band is authored across rows 0–240.
      expect(band(png, 0, "r")).toBeGreaterThan(0.8);
      expect(band(png, 1680, "r")).toBeLessThan(0.05);
      // Motion green band is authored across rows 480–720; its mirror would be rows 1200–1440.
      expect(band(png, 480, "g")).toBeGreaterThan(0.8);
      expect(band(png, 1200, "g")).toBeLessThan(0.05);
    }, 180000);
  }

  for (const ss of SS_ORIENTATION_ONLY) {
    it(`keeps effect-filtered motion layers upright at SS=${ss}`, async () => {
      const png = await render(propsFor({ effect: true }), ss);
      expect(band(png, 480, "g")).toBeGreaterThan(0.8);
      expect(band(png, 1200, "g")).toBeLessThan(0.05);
    }, 180000);

    // focusY must mean "fraction from the TOP", like every other coordinate in the spec. The green
    // band occupies rows 480–720 of 1920, so its own centre is uv.y ≈ 0.3125 from the top and
    // ≈ 0.6875 from the bottom. Focusing at 0.3125 therefore keeps it sharp only if the shader
    // measures downward; the pair below is what makes that claim load-bearing rather than assumed.
    //
    // The metric is green bleeding into rows 464–476, just above the bar's top edge, sampled over
    // the middle 200px where the radial focal circle sits. Measured values at radius 16:
    // sharp ≈ 0.022 (indistinguishable from no effect), blurred ≈ 0.344.
    const focusedAt = async (focusY: number) => {
      const p = propsFor();
      (p.segments[0] as { effects?: unknown }).effects = [
        { kind: "blur", params: { radius: 16, focusY, focusRadius: 0.12, focusFeather: 0.05 } },
      ];
      return patch(await render(p, ss), 440, 464, 200, 12, "g");
    };

    // Asserted as a RATIO between the two placements rather than against absolute levels: how far
    // ink actually bleeds in output pixels depends on the supersample factor (SS=1 measures ~0.34
    // blurred, SS=2 ~0.10), but "focused on the bar is much sharper than focused away from it" is
    // the claim under test and holds at either. Both placements are the same distance from the
    // bar — 0.3125 from the top, 0.6875 from the bottom — so only the axis direction distinguishes
    // them. gl_FragCoord.y is bottom-up over the layer target, and without the flip in defocus()
    // these two results swap.
    it(`measures focusY from the TOP, like every other spec coordinate, at SS=${ss}`, async () => {
      const onBand = await focusedAt(0.3125);
      const away = await focusedAt(0.6875);
      expect(away).toBeGreaterThan(onBand * 3);
    }, 360000);
  }
});
