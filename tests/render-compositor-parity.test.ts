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

// One entry per provider the compositor must cover.
const MATRIX: Array<{ name: string; props: KinoProps; frame: number }> = [
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
  { name: "film-finish", props: mk([{ kind: "scene", caption: "", startSec: 0, endSec: 2 }], { theme: { ...theme, film: 1 } }), frame: 10 },
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
  for (const { name, props, frame } of MATRIX) {
    it(`${name} matches within ${PARITY_THRESHOLD}`, async () => {
      const dom = await renderOne(props, frame, false);
      const gl = await renderOne(props, frame, true);
      const diff = meanDiff(dom, gl);
      // Surface the number even on success — a diff creeping toward the gate is a warning.
      console.log(`parity ${name}: meanDiff=${diff}`);
      expect(diff).toBeLessThanOrEqual(PARITY_THRESHOLD);
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
