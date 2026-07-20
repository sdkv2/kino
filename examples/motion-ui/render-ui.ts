// Speech-synced UI pages (Tier 2) — verification stills / optional mp4 for the
// four components in assets-lib/motion/{prompt-type,json-type,build-pipeline,loop-ready}.js
// Run: `npx tsx examples/motion-ui/render-ui.ts`  (FLEX_VIDEO=1 for the mp4).
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { renderStills, renderVideo } from "../../src/render/render.js";
import { resolveMotionGraphic } from "../../src/render/motiongraphic.js";
import type { KinoProps, MotionGraphicProps, WordTiming } from "../../src/render/props.js";

const here = dirname(fileURLToPath(import.meta.url));
const lib = join(here, "../../assets-lib/motion");
const project = { assetPath: (rel: string) => join(lib, rel.replace(/^motion\//, "")) };

const theme = {
  font: '"Inter", "Helvetica Neue", Helvetica, Arial, sans-serif',
  labelFont: '"IBM Plex Mono", Menlo, monospace',
  night: "#0b1020", mint: "#80e2b4", green: "#0c8d64", gold: "#d99a20", white: "#ffffff",
  captionFontSize: 74, captionStroke: 9, film: 0,
};

/** Rough even spacing across `dur` so typing / pipeline demos have words without real VO. */
function mockWords(text: string, dur: number): WordTiming[] {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return [];
  const slot = dur / parts.length;
  return parts.map((word, i) => ({
    word,
    start: i * slot,
    end: Math.min(dur - 0.02, (i + 0.85) * slot),
  }));
}

function page(source: string, text: string, startSec: number, endSec: number, triggers: { at: number; action: "pulse" }[] = []): KinoProps["segments"][number] {
  const dur = endSec - startSec;
  const motion: MotionGraphicProps = {
    ...resolveMotionGraphic({ source, triggers }, project),
    words: mockWords(text, dur),
  };
  return { kind: "motion", caption: "", startSec, endSec, motion };
}

const props: KinoProps = {
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null,
  background: {
    kind: "solid", image: null, customCode: null,
    params: { colorA: theme.night, intensity: 0 },
    keyframes: [], triggers: [],
  },
  disclosure: "motion-ui — speech-synced pages from assets-lib/motion",
  segments: [
    page("prompt-type.js", "Make me an advert.", 0, 2.4),
    page("json-type.js", "Your agent writes a real JSON spec.", 2.4, 5.4),
    page("build-pipeline.js", "One command builds it. Voiceover, motion, render, mp4.", 5.4, 10.2, [
      { at: 1.6, action: "pulse" }, { at: 2.5, action: "pulse" },
      { at: 3.4, action: "pulse" }, { at: 4.2, action: "pulse" },
    ]),
    page("loop-ready.js", "Tell your agent.", 10.2, 12.0),
  ],
};

const outDir = join(here, "out");
mkdirSync(outDir, { recursive: true });

if (process.env.FLEX_VIDEO) {
  const outs = await renderVideo({
    props, publicDir: mkdtempSync(join(tmpdir(), "mui-")), formats: ["9:16"], outDir, title: "motion-ui",
  });
  console.log("video:", outs.join(", "));
} else {
  const frames = [
    { frame: 20, name: "01-prompt-typing" },
    { frame: 55, name: "01b-prompt-pushed" },
    { frame: 100, name: "02-json-mid" },
    { frame: 200, name: "03-pipeline" },
    { frame: 290, name: "03b-pipeline-mp4" },
    { frame: 340, name: "04-loop-ready" },
  ];
  const outs = await renderStills({
    props, publicDir: mkdtempSync(join(tmpdir(), "mui-")), format: "9:16", frames, outDir,
  });
  console.log("stills:\n" + outs.join("\n"));
}
