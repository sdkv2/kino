// Parity gate: every provider, rendered both ways, compared. Byte equality is not achievable —
// GL blending and Chromium's rasterizer disagree on antialiased edges — so the gate is a mean
// absolute difference threshold, per the spec.
import { describe, it, expect } from "vitest";
import { renderStills } from "../src/render/render.js";
import { magick } from "./magick.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KinoProps, KinoSegment } from "../src/render/props.js";

const PARITY_THRESHOLD = 0.01;

const theme = {
  font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64",
  gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9,
  film: 0, // parity rows compare compositing, not the GL vs CSS film finish
};
const canvasBg = {
  kind: "custom" as const, image: null, shaderCode: null,
  customCode: "const w=ctx.canvas.width,h=ctx.canvas.height;const g=ctx.createLinearGradient(0,0,w,h);g.addColorStop(0,'#0b1020');g.addColorStop(1,'#0c8d64');ctx.fillStyle=g;ctx.fillRect(0,0,w,h);",
  params: {}, keyframes: [], triggers: [],
};

const mk = (segments: KinoSegment[], over: Partial<KinoProps> = {}): KinoProps => ({
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null,
  background: canvasBg, disclosure: "", segments, ...over,
});

const motion = {
  html: `<style>.c{position:absolute;left:10%;right:10%;top:35%;bottom:35%;border-radius:48px;background:#80e2b4}</style><div class="c"></div>`,
  params: {}, keyframes: [], triggers: [],
};
const blackBg = {
  ...canvasBg,
  customCode: "ctx.fillStyle='#000000';ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height);",
};
const fullMotion = {
  // Fullscreen white remains the mask fixture; the hard internal edge makes blur observable.
  html: `<style>.h{position:absolute;inset:0;background:#fff}.e{position:absolute;inset:25% 45%;background:#000}</style><div class="h"></div><div class="e"></div>`,
  params: {}, keyframes: [], triggers: [],
};

// One entry per provider the compositor must cover.
const MATRIX: Array<{ name: string; props: KinoProps; frame: number; threshold?: number }> = [
  { name: "canvas2d-background", props: mk([{ kind: "scene", caption: "", startSec: 0, endSec: 2 }]), frame: 10 },
  { name: "static-motion", props: mk([{ kind: "motion", caption: "", startSec: 0, endSec: 2, motion }]), frame: 15 },
  { name: "motion-overlay", props: mk([{ kind: "scene", caption: "", startSec: 0, endSec: 2, motionOverlay: motion }]), frame: 15 },
  { name: "phrase-caption", props: mk([{ kind: "scene", caption: "deterministic by design", startSec: 0, endSec: 2 }]), frame: 35 },
  {
    name: "words-caption",
    props: mk([{
      kind: "scene", caption: "ship it fast", startSec: 0, endSec: 3, captionMode: "words",
      words: [
        { word: "ship", start: 0.0, end: 0.5 },
        { word: "it", start: 0.5, end: 0.9 },
        { word: "fast", start: 0.9, end: 1.6 },
      ],
    }]),
    frame: 20,
  },
  { name: "disclosure", props: mk([{ kind: "scene", caption: "", startSec: 0, endSec: 2 }], { disclosure: "AI generated" }), frame: 10 },
  { name: "film-finish", props: mk([{ kind: "scene", caption: "", startSec: 0, endSec: 2 }], { theme: { ...theme, film: 1 } }), frame: 10,
    // GL vignette/grain vs CSS radial-gradient + SVG noise — accepted 2026-07-26 after eye check.
    threshold: 0.06 },
];

async function renderOne(props: KinoProps, frame: number, compositor: boolean): Promise<string> {
  if (compositor) process.env.KINO_COMPOSITOR = "1";
  else delete process.env.KINO_COMPOSITOR;
  const [png] = await renderStills({
    props,
    publicDir: mkdtempSync(join(tmpdir(), "parity-pub-")),
    format: "9:16",
    frames: [{ frame, name: compositor ? "gl" : "dom" }],
    outDir: mkdtempSync(join(tmpdir(), "parity-out-")),
  });
  return png;
}

const meanDiff = (a: string, b: string) =>
  parseFloat(magick([a, b, "-compose", "difference", "-composite", "-format", "%[fx:mean]", "info:"]).trim());

describe("compositor parity with the DOM path", () => {
  for (const { name, props, frame, threshold = PARITY_THRESHOLD } of MATRIX) {
    it(`${name} matches within ${threshold}`, async () => {
      const dom = await renderOne(props, frame, false);
      const gl = await renderOne(props, frame, true);
      const diff = meanDiff(dom, gl);
      // Surface the number even on success — a diff creeping toward the gate is a warning.
      console.log(`parity ${name}: meanDiff=${diff}`);
      expect(diff).toBeLessThanOrEqual(threshold);
    }, 300000);
  }
});

describe("compositor self-determinism", () => {
  it("renders the same frame identically twice", async () => {
    process.env.KINO_COMPOSITOR = "1";
    try {
      const pngs = await renderStills({
        props: MATRIX[1].props,
        publicDir: mkdtempSync(join(tmpdir(), "det-pub-")),
        format: "9:16",
        frames: [{ frame: 15, name: "a" }, { frame: 15, name: "b" }],
        outDir: mkdtempSync(join(tmpdir(), "det-out-")),
      });
      expect(meanDiff(pngs[0], pngs[1])).toBe(0);
    } finally {
      delete process.env.KINO_COMPOSITOR;
    }
  }, 300000);
});

describe("compositor mask and effect determinism", () => {
  const baseSegment: KinoSegment = {
    kind: "motion", caption: "", startSec: 0, endSec: 2, motion: fullMotion,
  };
  const baseProps = mk([baseSegment], { background: blackBg });

  async function expectDeterministicAndNonTrivial(props: KinoProps) {
    const first = await renderOne(props, 10, true);
    const second = await renderOne(props, 10, true);
    const plain = await renderOne(baseProps, 10, true);
    expect(meanDiff(first, second)).toBe(0);
    expect(meanDiff(first, plain)).toBeGreaterThan(0);
  }

  it("renders a shape mask deterministically and non-trivially", async () => {
    await expectDeterministicAndNonTrivial(mk([{
      ...baseSegment,
      mask: { source: { kind: "shape", shape: { kind: "rect", x: 0, y: 0, w: 540, h: 1920 } } },
    }], { background: blackBg }));
  }, 300000);

  it("renders blur deterministically and non-trivially", async () => {
    await expectDeterministicAndNonTrivial(mk([{
      ...baseSegment,
      effects: [{ kind: "blur", params: { radius: 8 } }],
    }], { background: blackBg }));
  }, 300000);
});
