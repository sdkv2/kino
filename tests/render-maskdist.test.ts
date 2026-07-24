// kinoMaskDist through a REAL render. Every other test of this helper is a string assertion on the
// assembled source, which cannot catch a helper that returns a constant, saturates at the radius,
// inverts its sign, or returns the right shape at the wrong scale — all four compile and all four
// read identically as text. So: draw a disc mask,
// shade the frame by predicates on the signed distance, and measure how much of the frame lights up.
import { describe, it, expect } from "vitest";
import { renderStills } from "../src/render/render.js";
import { magick } from "./magick.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KinoProps } from "../src/render/props.js";

// film: 0 kills the vignette+grain finishing pass, and disclosure "" the corner text — both paint
// pixels over the probe and would blur a coverage measurement that is the whole point here.
const theme = { font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64", gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9, film: 0 };
const params = { colorA: "#80e2b4", colorB: "#0c8d64", colorC: "#d99a20", intensity: 0.5 };
const bg = {
  kind: "custom" as const, image: null,
  customCode: "ctx.fillStyle='#000';ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height);",
  shaderCode: null,
  params, keyframes: [], triggers: [],
};

const W = 1080, H = 1920, CX = 540, CY = 960, R = 300;

// One distance read, at its OWN radius. Past the mask's ~1px transition band the helper falls back
// to a 24-tap spiral that resolves no finer than ~0.36*radius, so each probe must pass the SMALLEST
// radius that covers its own effect — at radius 32 the search error alone exceeds the 2px window the
// ring probe measures. Emitted as a local (not a file-scope helper): the region assembler
// concatenates the subject and background bodies into ONE translation unit, so anything declared at
// file scope in a body passed to both sides is a duplicate definition.
const probe = (name: string, radius: number) =>
  `  float ${name} = kinoMaskDist(uMask0, uChannel0, f, ${radius.toFixed(1)});`;

// All three probes ride ONE frame on separate colour channels — r = the boundary band, g = the deep
// interior, b = the magnitude ramp. Cheaper than a render each, and one frame is enough. (This used
// to be load-bearing: RegionShader kept its compiled program across renders, so a second
// renderStills call with the same segment shape silently re-measured the first call's GLSL. Fixed
// by the glKey guard in RegionShader.tsx; tests/render-region-reuse.test.ts is the regression.)
const body =
  "void mainImage(out vec4 c, in vec2 f){\n" +
  probe("dRing", 8.0) +
  "\n" +
  probe("dInside", 16.0) +
  "\n" +
  // |d| <= 2 → a ~4px ring on the mask boundary. d < -8 → everything deeper than 8px INSIDE the disc.
  // b = the SHORTFALL of a graded ramp, gated to the disc's interior: 1 at the boundary falling to
  // 0 at 16px inside, and 0 everywhere outside. The two step() probes above are insensitive to the
  // SCALE of d — eroding a 300px disc by 8px is a 5% area change, so a helper returning 3*d still
  // lands inside every one of their bounds. This channel's mean is an integral of the distance
  // field itself over a 16px annulus, so it moves with the scale. The interior gate is what makes
  // it sensitive: without it the constant 13.6% disc area rides along and dilutes the signal 25x.
  // Radius 16 is reused deliberately — the ramp's width may not exceed the search radius.
  "  c = vec4(1.0 - step(2.0, abs(dRing)), 1.0 - step(-8.0, dInside),\n" +
  "           step(dInside, 0.0) * (1.0 - clamp(-dInside / 16.0, 0.0, 1.0)), 1.0);\n}";

// BOTH region bodies get the same body, so the reading does not depend on which side of the mask a
// pixel falls on — that is what lets a single frame observe distance across the boundary.
const maskProps: KinoProps = {
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null, background: bg, disclosure: "",
  segments: [{
    kind: "app", asset: "asset.png", caption: "", startSec: 0, endSec: 2,
    regionShader: {
      masks: [{ maskSrc: "mask.png", maskKind: "image" as const, channel: "gray" as const }],
      subjectCode: body, backgroundCode: body,
    },
  }],
};

const rgb = (p: string): number[] =>
  magick([p, "-format", "%[fx:mean.r] %[fx:mean.g] %[fx:mean.b]", "info:"]).trim().split(/\s+/).map(Number);
const meanDiff = (a: string, b: string) =>
  parseFloat(magick([a, b, "-compose", "difference", "-composite", "-format", "%[fx:mean]", "info:"]).trim());

describe("kinoMaskDist", () => {
  it("reads a real signed distance — a thin band at the edge, a filled interior", async () => {
    const publicDir = mkdtempSync(join(tmpdir(), "kino-maskdist-"));
    magick(["-size", `${W}x${H}`, "xc:black", "-fill", "white",
            "-draw", `circle ${CX},${CY} ${CX},${CY - R}`, join(publicDir, "mask.png")]);
    magick(["-size", `${W}x${H}`, "xc:#333333", join(publicDir, "asset.png")]);
    const out = await renderStills({
      props: maskProps, publicDir, format: "9:16",
      frames: [{ frame: 10, name: "probe" }, { frame: 10, name: "probe2" }],
      outDir: mkdtempSync(join(tmpdir(), "kino-maskdist-out-")),
    });
    const [ring, inside, ramp] = rgb(out[0]);
    const jitter = meanDiff(out[0], out[1]);
    console.log(`kinoMaskDist coverage: ring=${ring} inside=${inside} ramp=${ramp} jitter=${jitter}`);

    // Circumference 2*pi*300 * ~4px over a 1080x1920 frame is ~0.4% coverage. A constant return
    // would light the whole frame; saturation at ±radius would light none.
    expect(ring).toBeGreaterThan(0.0005);
    expect(ring).toBeLessThan(0.03);

    // ~13% of the frame. Catches an inverted sign: with the sign flipped, "deep inside" becomes
    // everything OUTSIDE the disc, which is ~86% of the frame instead of ~13%.
    expect(inside).toBeGreaterThan(0.05);
    expect(inside).toBeLessThan(0.30);

    // The interior must dominate the boundary band by a wide margin.
    expect(inside).toBeGreaterThan(ring * 5);

    // MAGNITUDE. Everything above is scale-blind; this is the only assertion that says 8 pixels is
    // 8 pixels. The blue shortfall integrates the distance field over the 16px annulus inside the
    // rim, so it scales roughly INVERSELY with a mis-scaled distance: measured 0.0055 correct,
    // 0.0014 if the helper returned 3*d (the ramp saturates 3x too early), 0.0929 if it returned
    // d/3 (the ramp barely climbs). Geometry predicts 0.0071; the real number is lower because the
    // spiral fallback over-reports distance just inside the rim (same effect as the thin ring).
    // The band is ~2x clear of both failures, which is as tight as the fallback's resolution allows.
    expect(ramp).toBeGreaterThan(0.003);
    expect(ramp).toBeLessThan(0.012);

    // Two seeks to the SAME frame index, in one process against one cached page, are byte-identical.
    // That is seek determinism only — it says nothing about a fresh process, a fresh page, or a
    // different render. It rules out per-draw drift in the probe: a helper that fed wall-clock time,
    // a frame counter or an unseeded random into the distance would differ between the two captures.
    expect(jitter).toBe(0);
  }, 180000);

  // GLSL_HELPERS is injected into assembleShaderSource too, where there are no uMaskN uniforms at
  // all — kinoMaskDist's sampler2D/vec4 args are its own parameters, so it must still compile there.
  // No other test renders a real GLSL background (every one sets shaderCode: null). A compile
  // failure now fails the render outright (src/render/native/page/fatal.ts), so the colour
  // assertion is not what catches that — it is what proves the shader's own output actually
  // reached the frame instead of being skipped or painted over by the night fill.
  it("compiles away unused in a plain shader background (no mask uniforms)", async () => {
    const props: KinoProps = {
      theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null, disclosure: "",
      background: { kind: "custom", image: null, customCode: null, params, keyframes: [], triggers: [],
        shaderCode: "void mainImage(out vec4 c, in vec2 f){ c = vec4(1.0, 0.0, 0.0, 1.0); }" },
      segments: [{ kind: "avatar", caption: "", startSec: 0, endSec: 2 }],
    };
    const out = await renderStills({
      props, publicDir: mkdtempSync(join(tmpdir(), "kino-maskdist-solid-")), format: "9:16",
      frames: [{ frame: 10, name: "solid" }], outDir: mkdtempSync(join(tmpdir(), "kino-maskdist-out-solid-")),
    });
    const [r, g, b] = rgb(out[0]);
    console.log(`plain shader background mean rgb: ${r} ${g} ${b}`);
    expect(r).toBeGreaterThan(0.9); // red = the shader's own output; the night fill would be r ~0.04
    expect(g).toBeLessThan(0.1);
    expect(b).toBeLessThan(0.1);
  }, 180000);
});
