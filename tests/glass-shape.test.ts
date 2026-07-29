import { describe, it, expect } from "vitest";
import {
  chamferDistance,
  encodeShapeSdf,
  lerpPathD,
  samplePathAnimate,
  shapeSdfMax,
} from "../src/render/native/page/lensShape.js";
import { lintMotionHtml } from "../src/render/motiongraphic.js";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepare } from "../src/commands/build.js";
import { renderStills } from "../src/render/render.js";
import { magick } from "./magick.js";
import type { KinoProps } from "../src/render/props.js";

const star = readFileSync("projects/compositor-demo/assets/motion/liquid-glass-star.html", "utf8");
const pathMorph = readFileSync("projects/compositor-demo/assets/motion/liquid-glass-path-morph.html", "utf8");
const smilMorph = readFileSync("projects/compositor-demo/assets/motion/liquid-glass-smil-morph.html", "utf8");
const stripes =
  "const w=ctx.canvas.width,h=ctx.canvas.height;for(let x=0;x<w;x+=64){ctx.fillStyle=((x/64)%2)?'#ffffff':'#000000';ctx.fillRect(x,0,64,h);}";

describe("kino-lens SVG shape", () => {
  it("encodeShapeSdf yields negative sd inside a filled disk", () => {
    const w = 64;
    const h = 64;
    const ss = 1;
    const rgba = new Uint8ClampedArray(w * h * 4);
    const cx = 32;
    const cy = 32;
    const r = 20;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const on = (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
        const i = (y * w + x) * 4;
        rgba[i] = rgba[i + 1] = rgba[i + 2] = 255;
        rgba[i + 3] = on ? 255 : 0;
      }
    }
    const maxDist = shapeSdfMax(w, h);
    encodeShapeSdf(rgba, w, h, ss, maxDist);
    const decode = (x: number, y: number) =>
      ((rgba[(y * w + x) * 4] / 255) - 0.5) * 2 * maxDist;
    expect(decode(cx, cy)).toBeLessThan(-10);
    expect(decode(0, 0)).toBeGreaterThan(10);
    expect(Math.abs(decode(cx + r, cy))).toBeLessThan(2.5);
    // Opaque alpha — canvas WebGL upload must not premultiply-away exterior SDF.
    expect(rgba[(cy * w + cx) * 4 + 3]).toBe(255);
    expect(rgba[3]).toBe(255);
  });

  it("chamferDistance is zero on seeds", () => {
    const w = 5;
    const h = 1;
    const seed = new Uint8Array([0, 0, 1, 0, 0]);
    const d = chamferDistance(seed, w, h);
    expect(d[2]).toBe(0);
    expect(d[0]).toBeGreaterThan(d[1]);
  });

  it("lerpPathD interpolates matching path numerics", () => {
    const a = "M0 0 L100 0 L100 100 L0 100 Z";
    const b = "M50 0 L100 50 L50 100 L0 50 Z";
    const mid = lerpPathD(a, b, 0.5);
    expect(mid).toContain("25");
    expect(lerpPathD(a, b, 0)).toBe(a);
    expect(lerpPathD(a, b, 1)).toBe(b);
  });

  it("samplePathAnimate lerps SMIL path values", () => {
    const path = {
      querySelector: () => ({
        getAttribute: (n: string) => {
          if (n === "values") return "M0 0 L100 0 L100 100 L0 100 Z;M50 0 L100 50 L50 100 L0 50 Z";
          if (n === "keyTimes") return "0;1";
          return null;
        },
      }),
    } as unknown as Element;
    expect(samplePathAnimate(path, 0)).toContain("M0 0");
    expect(samplePathAnimate(path, 1)).toContain("L100 50");
    expect(samplePathAnimate(path, 0.5)).toContain("25");
  });

  it("allows SMIL only in kino-lens-shape markup", () => {
    const html = readFileSync("projects/compositor-demo/assets/motion/liquid-glass-smil-morph.html", "utf8");
    expect(lintMotionHtml(html)).toEqual([]);
  });

  it("star silhouette differs from a round-rect card at the corners", async () => {
    const theme = {
      font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64",
      gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9, film: 0,
    };
    const bg = {
      kind: "custom" as const, image: null, shaderCode: null, customCode: stripes,
      params: {}, keyframes: [], triggers: [],
    };
    const rect = star.replace(
      /<svg class="kino-lens-shape"[\s\S]*?<\/svg>/,
      "",
    ).replace("border: none;", "border-radius: 48px; border: 3px solid rgba(255,255,255,.7);");
    const mk = (h: string): KinoProps => ({
      theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null,
      background: bg, disclosure: "",
      segments: [{ kind: "motion", caption: "", startSec: 0, endSec: 2, motion: { html: h, params: {}, keyframes: [], triggers: [] } }],
    });
    const outDir = mkdtempSync(join(tmpdir(), "glass-shape-"));
    const [starPng, rectPng] = await Promise.all([
      renderStills({ props: mk(star), publicDir: mkdtempSync(join(tmpdir(), "gs-")), format: "9:16", frames: [{ frame: 30, name: "star" }], outDir }),
      renderStills({ props: mk(rect), publicDir: mkdtempSync(join(tmpdir(), "gr-")), format: "9:16", frames: [{ frame: 30, name: "rect" }], outDir }),
    ]);
    const diff = parseFloat(
      magick([starPng[0], rectPng[0], "-compose", "difference", "-composite", "-format", "%[fx:mean]", "info:"]).trim(),
    );
    expect(diff).toBeGreaterThan(0.004);
  }, 180000);

  it("CSS path morph differs at morph 0 vs 1", async () => {
    const theme = {
      font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64",
      gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9, film: 0,
    };
    const bg = {
      kind: "custom" as const, image: null, shaderCode: null, customCode: stripes,
      params: {}, keyframes: [], triggers: [],
    };
    const mk = (morph: number): KinoProps => ({
      theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null,
      background: bg, disclosure: "",
      segments: [{
        kind: "motion", caption: "", startSec: 0, endSec: 2,
        motion: { html: pathMorph, params: { "glass-morph": morph }, keyframes: [], triggers: [] },
      }],
    });
    const outDir = mkdtempSync(join(tmpdir(), "glass-morph-"));
    const [a, b] = await Promise.all([
      renderStills({ props: mk(0), publicDir: mkdtempSync(join(tmpdir(), "gm0-")), format: "9:16", frames: [{ frame: 30, name: "a" }], outDir }),
      renderStills({ props: mk(1), publicDir: mkdtempSync(join(tmpdir(), "gm1-")), format: "9:16", frames: [{ frame: 30, name: "b" }], outDir }),
    ]);
    const diff = parseFloat(
      magick([a[0], b[0], "-compose", "difference", "-composite", "-format", "%[fx:mean]", "info:"]).trim(),
    );
    expect(diff).toBeGreaterThan(0.004);
  }, 180000);

  it("SMIL path morph differs at beat start vs midpoint", async () => {
    const theme = {
      font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64",
      gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9, film: 0,
    };
    const bg = {
      kind: "custom" as const, image: null, shaderCode: null, customCode: stripes,
      params: {}, keyframes: [], triggers: [],
    };
    const props: KinoProps = {
      theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null,
      background: bg, disclosure: "",
      segments: [{
        kind: "motion", caption: "", startSec: 0, endSec: 4,
        motion: { html: smilMorph, params: {}, keyframes: [], triggers: [] },
      }],
    };
    const outDir = mkdtempSync(join(tmpdir(), "glass-smil-"));
    const paths = await renderStills({
      props, publicDir: mkdtempSync(join(tmpdir(), "gs-")), format: "9:16",
      frames: [{ frame: 0, name: "a" }, { frame: 60, name: "b" }], outDir,
    });
    const diff = parseFloat(
      magick([paths[0], paths[1], "-compose", "difference", "-composite", "-format", "%[fx:mean]", "info:"]).trim(),
    );
    expect(diff).toBeGreaterThan(0.004);
  }, 180000);

  it("procedural wave beat animates across the beat", async () => {
    const spec = JSON.parse(
      readFileSync("projects/compositor-demo/specs/glass-refraction-demos.json", "utf8"),
    );
    const tmp = mkdtempSync(join(tmpdir(), "glass-wave-spec-"));
    writeFileSync(join(tmp, "s.json"), JSON.stringify({ ...spec, segments: [spec.segments[9]] }));
    const r = await prepare(join(tmp, "s.json"), {
      mock: true, format: "9:16", project: "compositor-demo",
    });
    const outDir = mkdtempSync(join(tmpdir(), "glass-wave-"));
    const paths = await renderStills({
      props: r.props, publicDir: r.publicDir, format: "9:16",
      frames: [{ frame: 0, name: "a" }, { frame: 45, name: "b" }], outDir,
    });
    const diff = parseFloat(
      magick([paths[0], paths[1], "-compose", "difference", "-composite", "-format", "%[fx:mean]", "info:"]).trim(),
    );
    expect(diff).toBeGreaterThan(0.004);
  }, 180000);

  it("demo spec beat renders", async () => {
    const r = await prepare("projects/compositor-demo/specs/glass-refraction-demos.json", {
      mock: true, format: "9:16", project: "compositor-demo", beat: "6",
    });
    const outDir = mkdtempSync(join(tmpdir(), "glass-star-beat-"));
    const [png] = await renderStills({
      props: r.props, publicDir: r.publicDir, format: "9:16",
      frames: [{ frame: 30, name: "star" }], outDir,
    });
    const std = parseFloat(magick([png, "-format", "%[fx:standard_deviation]", "info:"]).trim());
    expect(std).toBeGreaterThan(0.04);
  }, 180000);
});
