// End-to-end pixel proof for spec.layers[] (Task 8). Everything upstream — validateLayers,
// build.ts's node-side source resolution, layersAt's emission, buildRegistry's texture
// registration — verifies SHAPE: the right ids, the right z, the right provider. None of it
// proves a declared layer actually reaches the screen with the right look. This file renders
// real frames through the GL compositor and samples pixels to prove:
//
//   1. a declared image layer paints INSIDE its authored rect and nowhere else;
//   2/3. `blend` actually blends — screen strictly brightens, multiply strictly darkens, the
//        same opaque source over the same mid-grey backdrop;
//   4. an adjustment layer's effect reaches only what is BENEATH it in z — the claim that
//      motivated the whole open-layer design, and the one nothing else guards;
//   5. `segment` + `hold` binds a layer's visibility window to a beat WITHOUT pulling it into
//      that beat's crossfade group, so it holds steady while the beats under it dissolve.
//
// Harness matches tests/compositor-layer-mask.test.ts exactly: renderStills boots a real
// Electron/GL compositor page. KINO_GPU=0 (vitest.config.ts) pins the backend to SwiftShader, and
// every assertion here compares two renders that differ in exactly one spec field rather than
// asserting an absolute pixel value, which would be fragile across GL backends.
import { describe, it, expect } from "vitest";
import { renderStills } from "../src/render/render.js";
import { magick } from "./magick.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KinoProps } from "../src/render/props.js";

const theme = {
  font: "Arial", night: "#000000", mint: "#80e2b4", green: "#0c8d64",
  gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9,
  // Cinematic finish off: the default `film` adjustment layer would otherwise grade/grain every
  // frame on top of whatever this file is trying to isolate.
  film: 0,
};

const blackBg = {
  kind: "custom" as const, image: null, shaderCode: null,
  customCode: "ctx.fillStyle='#000000';ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height);",
  params: {}, keyframes: [], triggers: [],
};

const midGreyBg = {
  kind: "custom" as const, image: null, shaderCode: null,
  customCode: "ctx.fillStyle='#808080';ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height);",
  params: {}, keyframes: [], triggers: [],
};

const cropMean = (path: string, geometry: string): number =>
  parseFloat(magick([path, "-crop", geometry, "+repage", "-format", "%[fx:mean]", "info:"]).trim());

// Diffs the SAME crop of two images without ever writing an intermediate file — parenthesised
// groups crop each input independently, in memory, before compositing. (Writing 8-bit crops of a
// solid grey/black region to disk and re-reading them trips ImageMagick's "RGB profile not
// permitted on grayscale PNG" warning, which is noise, not signal.)
const cropDiffMean = (a: string, b: string, geometry: string): number =>
  parseFloat(
    magick([
      "(", a, "-crop", geometry, "+repage", ")",
      "(", b, "-crop", geometry, "+repage", ")",
      "-compose", "difference", "-composite", "-format", "%[fx:mean]", "info:",
    ]).trim(),
  );

describe("declared layers — pixel proof", () => {
  it("an image declared layer paints inside its rect and nowhere else", async () => {
    process.env.KINO_COMPOSITOR = "1";
    try {
      const publicDir = mkdtempSync(join(tmpdir(), "kino-decl-img-"));
      magick(["-size", "1080x1920", "xc:#ffffff", join(publicDir, "leak.png")]);

      const props: KinoProps = {
        theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null,
        background: blackBg, disclosure: "",
        segments: [],
        layers: [{
          id: "leak", z: 350,
          source: { kind: "image", src: "leak.png", url: "leak.png" },
          rect: { x: 0, y: 0, w: 50, h: 100 },
        }],
      };
      const [png] = await renderStills({
        props, publicDir, format: "9:16",
        frames: [{ frame: 10, name: "leak" }],
        outDir: mkdtempSync(join(tmpdir(), "kino-decl-img-out-")),
      });

      // Left half (0..540) is the declared layer's rect, painted white over a black backdrop.
      // Right half (540..1080) is outside the rect: pure backdrop, no layer at all.
      const left = cropMean(png, "540x1920+0+0");
      const right = cropMean(png, "540x1920+540+0");
      expect(left).toBeGreaterThan(0.9);
      expect(right).toBeLessThan(0.1);
    } finally {
      delete process.env.KINO_COMPOSITOR;
    }
  }, 300000);

  it("blend: screen is strictly brighter than blend: normal, same source over the same mid-grey backdrop", async () => {
    process.env.KINO_COMPOSITOR = "1";
    try {
      const publicDir = mkdtempSync(join(tmpdir(), "kino-decl-screen-"));
      magick(["-size", "1080x1920", "xc:#999999", join(publicDir, "src.png")]);
      const outDir = mkdtempSync(join(tmpdir(), "kino-decl-screen-out-"));

      const mkProps = (blend: "normal" | "screen"): KinoProps => ({
        theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null,
        background: midGreyBg, disclosure: "",
        segments: [],
        layers: [{ id: "src", z: 350, source: { kind: "image", src: "src.png", url: "src.png" }, blend }],
      });

      const [normalPng] = await renderStills({ props: mkProps("normal"), publicDir, format: "9:16", frames: [{ frame: 5, name: "normal" }], outDir });
      const [screenPng] = await renderStills({ props: mkProps("screen"), publicDir, format: "9:16", frames: [{ frame: 5, name: "screen" }], outDir });

      // Centre of the frame, well inside both the full-bleed source and the full-bleed backdrop —
      // no rect edges anywhere near this crop.
      const region = "400x400+340+760";
      const normalMean = cropMean(normalPng, region);
      const screenMean = cropMean(screenPng, region);
      expect(screenMean).toBeGreaterThan(normalMean + 0.05);
    } finally {
      delete process.env.KINO_COMPOSITOR;
    }
  }, 300000);

  it("blend: multiply is strictly darker than blend: normal, same source over the same mid-grey backdrop", async () => {
    process.env.KINO_COMPOSITOR = "1";
    try {
      const publicDir = mkdtempSync(join(tmpdir(), "kino-decl-multiply-"));
      magick(["-size", "1080x1920", "xc:#999999", join(publicDir, "src.png")]);
      const outDir = mkdtempSync(join(tmpdir(), "kino-decl-multiply-out-"));

      const mkProps = (blend: "normal" | "multiply"): KinoProps => ({
        theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null,
        background: midGreyBg, disclosure: "",
        segments: [],
        layers: [{ id: "src", z: 350, source: { kind: "image", src: "src.png", url: "src.png" }, blend }],
      });

      const [normalPng] = await renderStills({ props: mkProps("normal"), publicDir, format: "9:16", frames: [{ frame: 5, name: "normal" }], outDir });
      const [multiplyPng] = await renderStills({ props: mkProps("multiply"), publicDir, format: "9:16", frames: [{ frame: 5, name: "multiply" }], outDir });

      const region = "400x400+340+760";
      const normalMean = cropMean(normalPng, region);
      const multiplyMean = cropMean(multiplyPng, region);
      expect(multiplyMean).toBeLessThan(normalMean - 0.05);
    } finally {
      delete process.env.KINO_COMPOSITOR;
    }
  }, 300000);

  it("a grade adjustment layer changes the footage beneath it but leaves the caption above it unchanged", async () => {
    process.env.KINO_COMPOSITOR = "1";
    try {
      const publicDir = mkdtempSync(join(tmpdir(), "kino-decl-grade-"));
      // A single footage still: grey top (y 0..900) over black everywhere else. Black is a fixed
      // point of brightness-only grading (0 * anything = 0), so the caption band (which sits well
      // inside the black region) reveals an invariant colour through its own transparent/AA pixels
      // no matter what the adjustment layer does — the discriminating region doesn't depend on
      // hitting exact glyph pixels.
      magick(["-size", "1080x1920", "xc:black", "-fill", "#808080", "-draw", "rectangle 0,0 1080,900", join(publicDir, "footage.png")]);
      const outDir = mkdtempSync(join(tmpdir(), "kino-decl-grade-out-"));

      const mkProps = (withGrade: boolean): KinoProps => ({
        theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null,
        background: blackBg, disclosure: "",
        segments: [{ kind: "video", source: "footage.png", caption: "TEST CAPTION", startSec: 0, endSec: 3 }],
        layers: withGrade
          ? [{ id: "grade", z: 350, adjust: [{ kind: "grade", params: { brightness: 2.0 } }] }]
          : [],
      });

      const [basePng] = await renderStills({ props: mkProps(false), publicDir, format: "9:16", frames: [{ frame: 30, name: "base" }], outDir });
      const [gradedPng] = await renderStills({ props: mkProps(true), publicDir, format: "9:16", frames: [{ frame: 30, name: "graded" }], outDir });

      // Footage region: inside the grey patch, away from its own edges. z:300 < grade z:350, so
      // this must visibly brighten.
      const footageGeom = "400x400+340+300";
      const baseFootage = cropMean(basePng, footageGeom);
      const gradedFootage = cropMean(gradedPng, footageGeom);
      expect(gradedFootage).toBeGreaterThan(baseFootage + 0.1);

      // Caption band: full width, comfortably covering CAPTION_BOTTOM (470px) plus the text's own
      // height and shadow blur. z:1100 > grade z:350, so this must be byte-identical.
      const captionGeom = "1080x620+0+1300";
      expect(cropDiffMean(basePng, gradedPng, captionGeom)).toBe(0);
    } finally {
      delete process.env.KINO_COMPOSITOR;
    }
  }, 300000);

  it("a held layer bound to a segment is byte-identical across a transition while the beats beneath it change", async () => {
    process.env.KINO_COMPOSITOR = "1";
    try {
      const publicDir = mkdtempSync(join(tmpdir(), "kino-decl-hold-"));
      magick(["-size", "100x100", "xc:#808080", join(publicDir, "held.png")]);

      const blackMotion = {
        html: `<style>.h{position:absolute;inset:0;background:#000000}</style><div class="h"></div>`,
        params: {}, keyframes: [], triggers: [],
      };
      const whiteMotion = {
        html: `<style>.h{position:absolute;inset:0;background:#ffffff}</style><div class="h"></div>`,
        params: {}, keyframes: [], triggers: [],
      };

      // Two fullscreen motion beats with a "fade" handoff (MOTION_XFADE_FRAMES = 15 @ 30fps):
      // beat0 (black) held through the overlap, beat1 (white) fading in over frames 60..75. The
      // declared layer is bound to beat1 with `hold`, which keeps it OUT of the crossfade group
      // (layers.ts §11b: `group: bound && !d.hold ? ... : undefined`) — it should just sit there,
      // painted after the mix, unaffected by it.
      const props: KinoProps = {
        theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null,
        background: blackBg, disclosure: "",
        segments: [
          { kind: "motion", caption: "", startSec: 0, endSec: 2, motion: blackMotion },
          { kind: "motion", caption: "", startSec: 2, endSec: 4, motion: whiteMotion, transition: "fade" },
        ],
        layers: [{
          id: "heldLayer", z: 815, // above Z.motion (810), below Z.overlay (820) — paints over the beats
          source: { kind: "image", src: "held.png", url: "held.png" },
          rect: { x: 0, y: 0, w: 50, h: 100 }, // left half only, so the right half stays bare crossfade
          segment: 1, hold: true,
        }],
      };

      const outDir = mkdtempSync(join(tmpdir(), "kino-decl-hold-out-"));
      // Transition window is frames [60, 75]; midpoint ~68, one frame either side.
      const [before, mid, after] = await renderStills({
        props, publicDir, format: "9:16",
        frames: [{ frame: 67, name: "before" }, { frame: 68, name: "mid" }, { frame: 69, name: "after" }],
        outDir,
      });

      // Held layer's own rect (left half, away from its edges): must be byte-identical across all
      // three frames — nothing about it is time-varying.
      const heldGeom = "300x300+100+700";
      expect(cropDiffMean(before, mid, heldGeom)).toBe(0);
      expect(cropDiffMean(mid, after, heldGeom)).toBe(0);

      // Right half (outside the held layer's rect): the bare beat0/beat1 crossfade, which must
      // keep moving — proof the sampled window is a genuine transition and not a frozen frame.
      const beneathGeom = "300x300+700+700";
      const beforeMean = cropMean(before, beneathGeom);
      const midMean = cropMean(mid, beneathGeom);
      const afterMean = cropMean(after, beneathGeom);
      expect(midMean).toBeGreaterThan(beforeMean + 0.02);
      expect(afterMean).toBeGreaterThan(midMean + 0.02);
    } finally {
      delete process.env.KINO_COMPOSITOR;
    }
  }, 300000);
});
