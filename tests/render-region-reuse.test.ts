// Two renders in ONE process, same segment shape, different region GLSL. The render page is cached
// per worker slot (engine.ts pageCache → window.kinoLoad()) and the React root is reused, so
// RegionShader's component instance survives from the first render into the second — it must NOT
// keep the first spec's compiled program. Before the glKey guard these two calls produced
// byte-identical PNGs, both showing the FIRST body.
//
// This file must stay on its own: the check only means anything when both renders share a process.
import { describe, it, expect } from "vitest";
import { renderStills } from "../src/render/render.js";
import { magick } from "./magick.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KinoProps } from "../src/render/props.js";

// film: 0 kills the vignette+grain pass, disclosure "" the corner text — both would tint a
// whole-frame mean that is meant to read as flat.
const theme = { font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64", gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9, film: 0 };
const bg = {
  kind: "custom" as const, image: null,
  customCode: "ctx.fillStyle='#000';ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height);",
  shaderCode: null,
  params: { colorA: "#80e2b4", colorB: "#0c8d64", colorC: "#d99a20", intensity: 0.5 },
  keyframes: [], triggers: [],
};

// Same body on BOTH region sides, so the mask can't decide the colour — every pixel of the beat is
// the constant this render's GLSL emits.
const flat = (rgb: string): string => `void mainImage(out vec4 c, in vec2 f){ c = vec4(${rgb}, 1.0); }`;

const propsFor = (rgb: string): KinoProps => ({
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null, background: bg, disclosure: "",
  segments: [{
    kind: "app", asset: "asset.png", caption: "", startSec: 0, endSec: 2,
    regionShader: {
      masks: [{ maskSrc: "mask.png", maskKind: "image" as const, channel: "gray" as const }],
      subjectCode: flat(rgb), backgroundCode: flat(rgb),
    },
  }],
});

const rgb = (p: string): number[] =>
  magick([p, "-format", "%[fx:mean.r] %[fx:mean.g] %[fx:mean.b]", "info:"]).trim().split(/\s+/).map(Number);

describe("RegionShader program cache", () => {
  it("recompiles when the region GLSL changes between renders in one process", async () => {
    const publicDir = mkdtempSync(join(tmpdir(), "kino-region-reuse-"));
    magick(["-size", "1080x1920", "xc:black", "-fill", "white",
            "-draw", "circle 540,960 540,660", join(publicDir, "mask.png")]);
    magick(["-size", "1080x1920", "xc:#333333", join(publicDir, "asset.png")]);

    const render = async (code: string, name: string): Promise<string> => {
      const out = await renderStills({
        props: propsFor(code), publicDir, format: "9:16",
        frames: [{ frame: 10, name }],
        outDir: mkdtempSync(join(tmpdir(), "kino-region-reuse-out-")),
      });
      return out[0];
    };

    const first = await render("1.0, 0.0, 0.0", "red");
    const second = await render("0.0, 0.0, 1.0", "blue");
    const [r1, , b1] = rgb(first);
    const [r2, , b2] = rgb(second);
    console.log(`region shader reuse: first r=${r1} b=${b1} second r=${r2} b=${b2}`);

    // A failed compile leaves the night fill (r ~0.04), so this also proves the shader ran.
    expect(r1).toBeGreaterThan(0.9);
    expect(b1).toBeLessThan(0.1);

    // The whole point: the second render must be BLUE, not a second copy of the red one.
    expect(b2).toBeGreaterThan(0.9);
    expect(r2).toBeLessThan(0.1);
  }, 240000);
});
