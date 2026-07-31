// Golden-image regression gate for the GL compositor (phase 4). DOM-path parity retired when the
// legacy render tree was deleted; these PNGs are the new baseline.
import { describe, it, expect } from "vitest";
import { renderStills } from "../src/render/render.js";
import { magick } from "./magick.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { KinoProps, KinoSegment } from "../src/render/props.js";

const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), "golden");
const PARITY_THRESHOLD = 0.01;
const UPDATE_GOLDEN = process.env.KINO_UPDATE_GOLDEN === "1";

const theme = {
  font: "Arial", bg: "#0b1020", accent: "#80e2b4", deep: "#0c8d64",
  accent2: "#d99a20", fg: "#fff", captionFontSize: 74, captionStroke: 9,
  film: 0,
};
const canvasBg = {
  kind: "custom" as const, image: null, shaderCode: null,
  customCode: "const w=ctx.canvas.width,h=ctx.canvas.height;const g=ctx.createLinearGradient(0,0,w,h);g.addColorStop(0,'#0b1020');g.addColorStop(1,'#0c8d64');ctx.fillStyle=g;ctx.fillRect(0,0,w,h);",
  params: {}, keyframes: [], triggers: [],
};

const mk = (segments: KinoSegment[], over: Partial<KinoProps> = {}): KinoProps => ({
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null,
  background: canvasBg, disclosure: "", segments, ...over,
});

const motion = {
  html: `<style>.c{position:absolute;left:10%;right:10%;top:35%;bottom:35%;border-radius:48px;background:#80e2b4}</style><div class="c"></div>`,
  params: {}, keyframes: [], triggers: [],
};

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
  { name: "film-finish", props: mk([{ kind: "scene", caption: "", startSec: 0, endSec: 2 }], { theme: { ...theme, film: 1 } }), frame: 10, threshold: 0.06 },
];

async function renderOne(props: KinoProps, frame: number, name: string): Promise<string> {
  const [png] = await renderStills({
    props,
    publicDir: mkdtempSync(join(tmpdir(), "golden-pub-")),
    format: "9:16",
    frames: [{ frame, name }],
    outDir: mkdtempSync(join(tmpdir(), "golden-out-")),
  });
  return png;
}

const meanDiff = (a: string, b: string) =>
  parseFloat(magick([a, b, "-compose", "difference", "-composite", "-format", "%[fx:mean]", "info:"]).trim());

describe("compositor golden images", () => {
  mkdirSync(GOLDEN_DIR, { recursive: true });
  for (const { name, props, frame, threshold = PARITY_THRESHOLD } of MATRIX) {
    it(`${name} matches golden within ${threshold}`, async () => {
      const png = await renderOne(props, frame, name);
      const golden = join(GOLDEN_DIR, `${name}.png`);
      if (UPDATE_GOLDEN || !existsSync(golden)) {
        writeFileSync(golden, readFileSync(png));
        if (!UPDATE_GOLDEN) console.log(`seeded golden ${name}`);
      }
      const diff = meanDiff(png, golden);
      console.log(`golden ${name}: meanDiff=${diff}`);
      expect(diff).toBeLessThanOrEqual(threshold);
    }, 300000);
  }
});

describe("compositor self-determinism", () => {
  it("renders the same frame identically twice", async () => {
    const pngs = await renderStills({
      props: MATRIX[1].props,
      publicDir: mkdtempSync(join(tmpdir(), "det-pub-")),
      format: "9:16",
      frames: [{ frame: 15, name: "a" }, { frame: 15, name: "b" }],
      outDir: mkdtempSync(join(tmpdir(), "det-out-")),
    });
    expect(meanDiff(pngs[0], pngs[1])).toBe(0);
  }, 300000);
});
