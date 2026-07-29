import { describe, it, expect } from "vitest";
import { renderStills } from "../src/render/render.js";
import { magick } from "./magick.js";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KinoProps } from "../src/render/props.js";
import { DEFAULT_LENS_ID, EFFECTS_LIB_DIR } from "../src/media/effectsLib.js";

const theme = { font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64", gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9 };
// Hard vertical stripes: any real refraction bends/shifts them, and a dead mirror leaves them
// untouched — maximum contrast for the on/off diff below.
const stripes =
  "const w=ctx.canvas.width,h=ctx.canvas.height;for(let x=0;x<w;x+=64){ctx.fillStyle=((x/64)%2)?'#ffffff':'#000000';ctx.fillRect(x,0,64,h);}";
const bg = { kind: "custom" as const, image: null, customCode: stripes, shaderCode: null, params: { colorA: "#80e2b4", colorB: "#0c8d64", colorC: "#d99a20", intensity: 0.5 }, keyframes: [], triggers: [] };

const card = (cls: string, attrs = "") =>
  `<style>.card{position:absolute;left:14%;right:14%;top:36%;bottom:36%;border-radius:48px;background:transparent;` +
  `--glass-strength:48px;--glass-band:120px;--glass-chroma:0.1}</style><div class="card ${cls}"${attrs}></div>`;

const defaultLens = readFileSync(join(EFFECTS_LIB_DIR, "liquid-glass.frag"), "utf8");
/** Flat magenta plate — same uniform contract, obviously different pixels vs liquid-glass. */
const magentaLens = `#version 300 es
precision highp float;
uniform sampler2D uBg; uniform sampler2D uShape; uniform vec4 uBgRect;
uniform float uIsFullBg; uniform float uUseShape; uniform vec2 uSize; uniform float uRadius;
uniform float uBand; uniform float uStrength; uniform float uChroma; uniform float uProfile;
uniform vec4 uFilm; uniform float uSaturate; uniform float uBrightness; uniform float uFrost;
uniform float uEdgeBlur; uniform float uSS; out vec4 outColor;
float sdRoundRect(vec2 p, vec2 center, vec2 half_, float r) {
  vec2 c = p - center; vec2 q = abs(c) - (half_ - vec2(r));
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
void main() {
  vec2 px = vec2(gl_FragCoord.x, uSize.y * uSS - gl_FragCoord.y) / uSS;
  vec2 half_ = 0.5 * uSize; float r = min(uRadius, min(half_.x, half_.y));
  float d = -sdRoundRect(px, half_, half_, r);
  float alpha = smoothstep(-3.5, 2.5, d);
  outColor = vec4(vec3(1.0, 0.0, 1.0) * alpha, alpha);
}`;

const mkProps = (html: string, lensShaders?: Record<string, string>): KinoProps => ({
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, background: bg, disclosure: "test",
  segments: [{
    kind: "motion", caption: "", startSec: 0, endSec: 2,
    motion: { html, params: {}, keyframes: [], triggers: [], ...(lensShaders ? { lensShaders } : {}) },
  }],
});

// Mean absolute difference between two frames (0..1). Dead glass ⇒ ~0.
const meanDiff = (a: string, b: string) =>
  parseFloat(magick([a, b, "-compose", "difference", "-composite", "-format", "%[fx:mean]", "info:"]).trim());

// CPU port of the analytic-roundrect displacement in liquid-glass.frag, enough to measure the
// corner. `inflate` mirrors the shader's rEff = max(radius, band).
function cornerJump(g: { w: number; h: number; r: number; band: number; strength: number }, inflate: boolean): number {
  const smoothstep = (a: number, b: number, x: number) => {
    const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
    return t * t * (3 - 2 * t);
  };
  const sd = (px: number, py: number, r: number) => {
    r = Math.min(r, Math.min(g.w, g.h) / 2);
    const qx = Math.abs(px - g.w / 2) - g.w / 2 + r;
    const qy = Math.abs(py - g.h / 2) - g.h / 2 + r;
    return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
  };
  const band = Math.min(g.band, Math.max(0.44 * Math.min(g.w, g.h), 1));
  const strength = Math.min(g.strength, band * 1.25);
  const rEff = inflate ? Math.max(g.r, band) : g.r;
  const gs = Math.min(Math.max(Math.min(band * 0.12, 3.5), 1), 0.2 * Math.min(g.w, g.h));
  const midR = Math.hypot(g.w / 2, g.h / 2);
  const offset = (px: number, py: number): [number, number] => {
    const bend = (x: number, y: number) => sd(x, y, rEff);
    const gvx = bend(px + gs, py) - bend(px - gs, py);
    const gvy = bend(px, py + gs) - bend(px, py - gs);
    const gl = Math.max(Math.hypot(gvx, gvy), 1e-4);
    const gAlive = smoothstep(0.04, 0.28, gl / (2 * gs));
    const dB = -bend(px, py);
    const rimF = Math.pow(Math.min(Math.max(1 - dB / band, 0), 1), 2.2);
    const fRim = rimF * strength * gAlive;
    const bodyK = 0;
    return [px - (gvx / gl) * gAlive * fRim - (px - g.w / 2) * bodyK, py - (gvy / gl) * gAlive * fRim - (py - g.h / 2) * bodyK];
  };
  // Walk perpendicular to the top-left corner diagonal; report the worst per-pixel offset step.
  let worst = 0;
  for (let t = 2; t < Math.min(g.w, g.h) / 2; t += 0.5) {
    let prev: [number, number] | null = null;
    for (let s = -20; s <= 20; s += 0.25) {
      const px = t + s * 0.7071;
      const py = t - s * 0.7071;
      if (px < 0.5 || py < 0.5) continue;
      const o = offset(px, py);
      if (prev) worst = Math.max(worst, Math.hypot(o[0] - prev[0], o[1] - prev[1]) / 0.25);
      prev = o;
    }
  }
  return worst;
}

describe("liquid glass corner bevel", () => {
  // A distance-to-silhouette bevel wider than the corner radius miters along the corner diagonal:
  // ∇SDF snaps 90° at d = radius and the rim tears into a hard triangular fan. The shader rides a
  // radius-inflated field instead, which pushes that kink out to d = band where the rim is zero.
  it("stays continuous across the corner diagonal when band > radius", () => {
    const sidebar = { w: 299, h: 871, r: 16, band: 56, strength: 40 };
    expect(cornerJump(sidebar, false)).toBeGreaterThan(5);
    expect(cornerJump(sidebar, true)).toBeLessThan(1.5);
    // …and the shipped shader really derives bend direction + rim profile from that field.
    expect(defaultLens).toMatch(/float rEff = max\([^;]*band\);/);
    expect(defaultLens).toMatch(/bendSd\(px \+ e\.xy, rEff\)/);
    expect(defaultLens).toMatch(/edgeU = clamp\(1\.0 - dB /);
  });
});

describe("liquid glass mirror (kino-lens)", () => {
  it("actually refracts — glass-on differs from glass-off, deterministically", async () => {
    // Guard for the whole silent-skip class: the mirror's WebGL shader failing to COMPILE (e.g. a
    // reserved-word identifier) makes makeState() return null and kino-lens degrade to a plain div
    // with zero console output in normal runs — renders "succeed" with no refraction anywhere.
    const outDir = mkdtempSync(join(tmpdir(), "kino-lens-"));
    const off = await renderStills({ props: mkProps(card("")), publicDir: mkdtempSync(join(tmpdir(), "glass-off-")), format: "9:16", frames: [{ frame: 20, name: "off" }], outDir });
    const on = await renderStills({ props: mkProps(card("kino-lens")), publicDir: mkdtempSync(join(tmpdir(), "glass-on-")), format: "9:16", frames: [{ frame: 20, name: "on" }, { frame: 20, name: "on2" }], outDir });
    expect(existsSync(off[0]) && existsSync(on[0])).toBe(true);
    // Mirror alive: film + displacement must move real pixels vs the identical DOM without the class.
    expect(meanDiff(off[0], on[0])).toBeGreaterThan(0.005);
    // Same frame twice → byte-identical pixels (deterministic WebGL path).
    expect(meanDiff(on[0], on[1])).toBe(0);
  }, 180000);

  it("kino-lens alias triggers the same refraction path", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "kino-lens-"));
    const off = await renderStills({ props: mkProps(card("")), publicDir: mkdtempSync(join(tmpdir(), "lens-off-")), format: "9:16", frames: [{ frame: 20, name: "off" }], outDir });
    const on = await renderStills({ props: mkProps(card("kino-lens")), publicDir: mkdtempSync(join(tmpdir(), "lens-on-")), format: "9:16", frames: [{ frame: 20, name: "on" }], outDir });
    expect(meanDiff(off[0], on[0])).toBeGreaterThan(0.005);
  }, 180000);

  it("data-lens override changes pixels vs default liquid-glass", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "kino-datalens-"));
    const shaders = { [DEFAULT_LENS_ID]: defaultLens, "magenta-plate": magentaLens };
    const def = await renderStills({
      props: mkProps(card("kino-lens"), shaders),
      publicDir: mkdtempSync(join(tmpdir(), "dl-def-")), format: "9:16",
      frames: [{ frame: 20, name: "def" }], outDir,
    });
    const mag = await renderStills({
      props: mkProps(card("kino-lens", ` data-lens="magenta-plate"`), shaders),
      publicDir: mkdtempSync(join(tmpdir(), "dl-mag-")), format: "9:16",
      frames: [{ frame: 20, name: "mag" }], outDir,
    });
    expect(meanDiff(def[0], mag[0])).toBeGreaterThan(0.02);
  }, 180000);
});
