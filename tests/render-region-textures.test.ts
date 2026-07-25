// Motion graphic INSIDE a region shader: `regionShader.textures` rasterizes a Tier-1 .html at
// composition size every frame and binds it to uTex2, so a region body can sample it. Two things
// only a real render can prove, and both are the point of the feature:
//   1. the markup reaches GL at all (a broken raster/upload is a transparent channel — invisible),
//   2. it animates on the BEAT's progress via the injected kino scrub stylesheet, which the raster
//      surface has to rebind from `:host` to its wrapper class or every kino-* rule dies silently.
import { describe, it, expect } from "vitest";
import { renderStills } from "../src/render/render.js";
import { magick } from "./magick.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KinoProps } from "../src/render/props.js";

const theme = { font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64", gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9, film: 0 };
const bg = {
  kind: "custom" as const, image: null,
  customCode: "ctx.fillStyle='#000';ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height);",
  shaderCode: null,
  params: { colorA: "#80e2b4", colorB: "#0c8d64", colorC: "#d99a20", intensity: 0.5 },
  keyframes: [], triggers: [],
};

const W = 1080, H = 1920;
const MX0 = 100, MX1 = 600, MY0 = 400, MY1 = 1500; // mask rect

// A full-frame graphic whose opacity rides `.kino-anim` — i.e. the injected scrub stylesheet's
// `animation-delay: calc((var(--progress)) * -1s)` against the 1s convention. Nothing here works
// unless BOTH the stylesheet and the --progress var made it into the raster.
const MOTION_HTML =
  "<style>@keyframes fade{0%{opacity:0}100%{opacity:1}}</style>" +
  // linear: `.kino-anim` sets no timing function, so CSS's default `ease` would put progress 0.5 at
  // ~0.80 opacity — a real curve, but one that makes the midpoint assertion below say less.
  '<div class="kino-anim" style="position:absolute;inset:0;background:#ff0000;' +
  'animation-name:fade;animation-timing-function:linear"></div>';

// Subject writes the channel's ALPHA to greyscale: 0 at beat start, 1 at beat end. Background is a
// constant blue control — it samples nothing, so any movement there means something else changed.
const SUBJ = "void mainImage(out vec4 c, in vec2 f){ vec4 g = texture(uTex2, f / iResolution.xy); c = vec4(vec3(g.a), 1.0); }";
const BG = "void mainImage(out vec4 c, in vec2 f){ c = vec4(0.0, 0.0, 1.0, 1.0); }";

const START = 2;
const props: KinoProps = {
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null, background: bg, disclosure: "",
  segments: [{
    kind: "video", source: "asset.png", caption: "", startSec: START, endSec: START + 3,
    regionShader: {
      masks: [{ maskSrc: "mask0.png", maskKind: "image" as const, channel: "gray" as const, subjectCode: null }],
      subjectCode: SUBJ,
      backgroundCode: BG,
      textures: [{ kind: "html" as const, src: null, html: MOTION_HTML }],
    },
  }],
};

const cropRgb = (p: string, w: number, h: number, x: number, y: number): number[] =>
  magick([p, "-crop", `${w}x${h}+${x}+${y}`, "+repage", "-format", "%[fx:mean.r] %[fx:mean.g] %[fx:mean.b]", "info:"])
    .trim().split(/\s+/).map(Number);
const meanDiff = (a: string, b: string) =>
  parseFloat(magick([a, b, "-compose", "difference", "-composite", "-format", "%[fx:mean]", "info:"]).trim());

describe("region shader texture channels", () => {
  it("samples a motion .html on uTex2, scrubbed by the beat's progress", async () => {
    const publicDir = mkdtempSync(join(tmpdir(), "kino-rtex-"));
    magick(["-size", `${W}x${H}`, "xc:black", "-fill", "white",
            "-draw", `rectangle ${MX0},${MY0} ${MX1},${MY1}`, join(publicDir, "mask0.png")]);
    magick(["-size", `${W}x${H}`, "xc:#333333", join(publicDir, "asset.png")]);

    const f = (s: number) => Math.round(s * 30);
    const out = await renderStills({
      props, publicDir, format: "9:16",
      frames: [
        { frame: f(START), name: "p0" },          // beat progress 0.0
        { frame: f(START + 1.5), name: "p05" },   // beat progress 0.5 (beat is 3s long)
        { frame: f(START + 2.9), name: "p97" },   // near the beat end
        { frame: f(START + 1.5), name: "p05b" },  // determinism repeat
      ],
      outDir: mkdtempSync(join(tmpdir(), "kino-rtex-out-")),
    });

    const sub = (p: string) => cropRgb(p, 300, 300, 200, 700);
    const back = (p: string) => cropRgb(p, 200, 300, 750, 700);
    const [p0, p05, p97] = [sub(out[0]), sub(out[1]), sub(out[2])];
    console.log(`region texture subject: p0=${p0} p0.5=${p05} p0.97=${p97}`);

    // Start transparent, end opaque: the channel carries the graphic AND it moved with the beat.
    expect(p0[0]).toBeLessThan(0.05);
    expect(p97[0]).toBeGreaterThan(0.9);
    // Mid-beat is the midpoint — a channel stuck on its first raster would sit at 0, one that
    // ignored --progress and ran a wall clock would land anywhere.
    expect(p05[0]).toBeGreaterThan(0.4);
    expect(p05[0]).toBeLessThan(0.6);

    // Control: no sampling in the background body, so it must not move (and proves the program
    // compiled — the night fill would read b≈0.13).
    expect(back(out[0])[2]).toBeGreaterThan(0.98);
    expect(back(out[2])[2]).toBeGreaterThan(0.98);

    // Same frame twice = byte-identical. The raster is a pure function of the scrub value.
    expect(meanDiff(out[1], out[3])).toBe(0);
  }, 240000);
});
