import { describe, it, expect } from "vitest";
import { renderStills } from "../src/render/render.js";
import { magick } from "./magick.js";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KinoProps } from "../src/render/props.js";

const theme = { font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64", gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9 };
// Hard vertical stripes: any real refraction bends/shifts them, and a dead mirror leaves them
// untouched — maximum contrast for the on/off diff below.
const stripes =
  "const w=ctx.canvas.width,h=ctx.canvas.height;for(let x=0;x<w;x+=64){ctx.fillStyle=((x/64)%2)?'#ffffff':'#000000';ctx.fillRect(x,0,64,h);}";
const bg = { kind: "custom" as const, image: null, customCode: stripes, shaderCode: null, params: { colorA: "#80e2b4", colorB: "#0c8d64", colorC: "#d99a20", intensity: 0.5 }, keyframes: [], triggers: [] };

const card = (cls: string) =>
  `<style>.card{position:absolute;left:14%;right:14%;top:36%;bottom:36%;border-radius:48px;background:transparent;` +
  `--glass-strength:48px;--glass-band:120px;--glass-chroma:0.1}</style><div class="card ${cls}"></div>`;

const mkProps = (html: string): KinoProps => ({
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null, background: bg, disclosure: "test",
  segments: [{ kind: "motion", caption: "", startSec: 0, endSec: 2, motion: { html, params: {}, keyframes: [], triggers: [] } }],
});

// Mean absolute difference between two frames (0..1). Dead glass ⇒ ~0.
const meanDiff = (a: string, b: string) =>
  parseFloat(magick([a, b, "-compose", "difference", "-composite", "-format", "%[fx:mean]", "info:"]).trim());

describe("liquid glass mirror (kino-glass)", () => {
  it("actually refracts — glass-on differs from glass-off, deterministically", async () => {
    // Guard for the whole silent-skip class: the mirror's WebGL shader failing to COMPILE (e.g. a
    // reserved-word identifier) makes makeState() return null and kino-glass degrade to a plain div
    // with zero console output in normal runs — renders "succeed" with no refraction anywhere.
    const outDir = mkdtempSync(join(tmpdir(), "kino-glass-"));
    const off = await renderStills({ props: mkProps(card("")), publicDir: mkdtempSync(join(tmpdir(), "glass-off-")), format: "9:16", frames: [{ frame: 20, name: "off" }], outDir });
    const on = await renderStills({ props: mkProps(card("kino-glass")), publicDir: mkdtempSync(join(tmpdir(), "glass-on-")), format: "9:16", frames: [{ frame: 20, name: "on" }, { frame: 20, name: "on2" }], outDir });
    expect(existsSync(off[0]) && existsSync(on[0])).toBe(true);
    // Mirror alive: film + displacement must move real pixels vs the identical DOM without the class.
    expect(meanDiff(off[0], on[0])).toBeGreaterThan(0.005);
    // Same frame twice → byte-identical pixels (deterministic WebGL path).
    expect(meanDiff(on[0], on[1])).toBe(0);
  }, 180000);
});
