import { describe, it, expect, afterAll } from "vitest";
import { glProbe, closeGlHost } from "./helpers/glHost.js";

afterAll(closeGlHost);

// Regression for the "solid renders as the default glow" report: a spec with
// `"background": "solid"` plus a spec-level scheme override (colors.bg #ffffff) produced the house
// navy with a soft white radial blob instead of a flat white frame. Two defects composed:
//   1. the `solid` preset hardcoded the house #0b1020 base and painted a colorA radial over it,
//      ignoring the resolved palette's bg role entirely;
//   2. scrimDraw's light-base alphas keyed off a `nightLuminance` param nobody passed, so a light
//      scheme got the dark-base 61% wash — the white blob — over whatever the backdrop painted.
// This drives the real registry (resolveBackgroundDraw → canvas2d params → pixels), i.e. the same
// wiring `kino build`/`kino still` use, not a hand-built draw call.
describe("solid background under a resolved colour scheme", () => {
  const W = 108;
  const H = 192;

  type Px = { backdrop: { corner: number[]; centre: number[] }; scrimCentreAlpha: number };

  const probe = (bg: string) =>
    glProbe<[string, number, number], Px>({
      entry: "src/render/native/page/compositor/registry.ts",
      globalName: "KinoReg",
      html: "<!doctype html><body></body>",
      fn: async (bgHex, w, h) => {
        // Ember-shaped palette with the spec's bg override already resolved in — mirroring how
        // build.ts lands spec.colors in brand.colors before theme/params are assembled.
        const props = {
          theme: {
            font: "Arial", fontUrl: null, fontFaces: null,
            bg: bgHex, fg: "#f4ede2", accent: "#ff7a3d", accent2: "#ffb03a", deep: "#7c2d12",
            brandName: "ember", captionFontSize: 74, captionStroke: 9, captionBg: null, film: 0,
          },
          fps: 30, avatar: null, avatarWindows: [], voTrack: null, disclosure: "",
          background: {
            kind: "solid", image: null, customCode: null, shaderCode: null, textures: [],
            params: { colorA: "#ff7a3d", colorB: "#7c2d12", colorC: "#ffb03a", intensity: 0.5 },
            keyframes: [], triggers: [],
          },
          segments: [],
          sfx: [], music: null,
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const reg = (window as any).KinoReg.buildRegistry(props, { width: w, height: h }, { width: w, height: h }, {}, 1);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const read = async (id: string): Promise<any> => {
          const src = reg.get(id);
          await src.prepare(0);
          const c = src.canvasForTest();
          const ctx = c.getContext("2d")!;
          const px = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data);
          return { corner: px(2, 2), centre: px(Math.round(w / 2), Math.round(h / 2)) };
        };
        const backdrop = await read("backdrop");
        // Read the scrim at its own gradient centre (0.5w, 0.48h) so the assert sees the a0 stop,
        // not a point already interpolating toward the mid stop.
        const scrimSrc = reg.get("scrim");
        await scrimSrc.prepare(0);
        const scrimCtx = scrimSrc.canvasForTest().getContext("2d")!;
        const scrimCentreAlpha = scrimCtx.getImageData(Math.round(w * 0.5), Math.round(h * 0.48), 1, 1).data[3];
        return { backdrop, scrimCentreAlpha };
      },
      args: [bg, W, H],
    });

  it("paints a light scheme's bg flat — corner AND centre — with the light scrim wash", async () => {
    const r = await probe("#ffffff");
    expect(r.backdrop.corner).toEqual([255, 255, 255, 255]);
    expect(r.backdrop.centre).toEqual([255, 255, 255, 255]); // the old draw put a colorA radial here
    // nightLuminance wired: light base takes the 0x33 wash, not the dark-base 0x9c blob.
    expect(Math.abs(r.scrimCentreAlpha - 0x33)).toBeLessThanOrEqual(3);
  });

  it("keeps the house scheme flat navy with the dark scrim wash unchanged", async () => {
    const r = await probe("#0b1020");
    expect(r.backdrop.corner).toEqual([11, 16, 32, 255]);
    expect(r.backdrop.centre).toEqual([11, 16, 32, 255]);
    expect(Math.abs(r.scrimCentreAlpha - 0x9c)).toBeLessThanOrEqual(3);
  });
}, 240000);
