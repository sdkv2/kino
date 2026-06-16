// Feature flex: render the motion-graphics showcase through kino's REAL render path.
// Each graphic is loaded + sanitized + linted by resolveMotionGraphic (the same build-time path
// the CLI uses), then composited by the live KinoVideo composition. No VO / avatar / brand needed —
// motion graphics are self-contained. Run: `npx tsx examples/motion-flex/render-flex.ts`
// (set FLEX_VIDEO=1 to render the mp4; default renders verification stills).
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { renderStills, renderVideo } from "../../src/render/render.js";
import { resolveMotionGraphic } from "../../src/render/motiongraphic.js";
import type { KinoProps } from "../../src/render/props.js";

const here = dirname(fileURLToPath(import.meta.url));
const project = { assetPath: (rel: string) => join(here, rel) };
const GOLD = "#d99a20";

const theme = {
  font: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  night: "#0b1020",
  mint: "#80e2b4",
  green: "#0c8d64",
  gold: GOLD,
  white: "#ffffff",
  captionFontSize: 74,
  captionStroke: 9,
};

const props: KinoProps = {
  theme,
  fps: 30,
  avatar: null,
  avatarWindows: [],
  voTrack: null,
  logo: null,
  background: {
    kind: "aurora",
    image: null,
    customCode: null,
    params: { colorA: theme.mint, colorB: theme.green, colorC: GOLD, intensity: 0.6 },
    keyframes: [],
    triggers: [],
  },
  disclosure: "motion graphics demo — authored in HTML, driven by JSON",
  // Longer beats that overlap ~0.4s so each crossfades into the next (every graphic exit-fades on --progress).
  segments: [
    {
      kind: "motion",
      caption: "",
      startSec: 0,
      endSec: 4.6,
      motion: resolveMotionGraphic(
        {
          source: "hero.html",
          // entrance params, smoothly easeInOut-eased by kino's keyframe engine → no bounce, gentle settle
          params: { gold: GOLD, kick: 0, t1: 0, t2: 0, rule: 0, sub: 0 },
          keyframes: [
            { at: 0.1, params: { kick: 0 } }, { at: 1.1, params: { kick: 1 }, ease: "easeInOut" },
            { at: 0.35, params: { t1: 0 } }, { at: 1.6, params: { t1: 1 }, ease: "easeInOut" },
            { at: 0.6, params: { t2: 0 } }, { at: 1.9, params: { t2: 1 }, ease: "easeInOut" },
            { at: 1.0, params: { rule: 0 } }, { at: 2.2, params: { rule: 1 }, ease: "easeInOut" },
            { at: 1.3, params: { sub: 0 } }, { at: 2.4, params: { sub: 1 }, ease: "easeInOut" },
          ],
          triggers: [{ at: 0.2, action: "pulse" }, { at: 2.4, action: "pulse" }],
        },
        project,
      ),
    },
    {
      kind: "motion",
      caption: "",
      startSec: 4.2,
      endSec: 9.2,
      motion: resolveMotionGraphic(
        {
          source: "stat.html",
          // entrance is staggered purely in CSS off --progress; only the count needs a keyframe.
          params: { pct: 0, gold: GOLD },
          keyframes: [
            { at: 0.7, params: { pct: 0 } }, { at: 4.0, params: { pct: 98 }, ease: "easeInOut" },
          ],
          triggers: [{ at: 0.5, action: "pulse" }, { at: 4.0, action: "pulse" }],
        },
        project,
      ),
    },
    {
      kind: "motion",
      caption: "",
      startSec: 8.8,
      endSec: 13.6,
      motion: resolveMotionGraphic(
        {
          source: "orbit.html",
          params: { gold: GOLD, enter: 0 },
          keyframes: [{ at: 0.1, params: { enter: 0 } }, { at: 1.5, params: { enter: 1 }, ease: "easeInOut" }],
          triggers: [{ at: 0.4, action: "pulse" }, { at: 2.4, action: "pulse" }, { at: 4.2, action: "pulse" }],
        },
        project,
      ),
    },
  ],
};

const outDir = join(here, "out");
mkdirSync(outDir, { recursive: true });

if (process.env.FLEX_VIDEO) {
  const outs = await renderVideo({ props, publicDir: mkdtempSync(join(tmpdir(), "flex-")), formats: ["9:16"], outDir, title: "motion-flex" });
  console.log("video:", outs.join(", "));
} else {
  // stat beat starts at frame 126 (4.2s); keyword stagger lands around progress 0.22–0.45 → frames ~159–193
  const frames = [
    { frame: 150, name: "01-stat-number-in" },
    { frame: 165, name: "02-kw-stagger-a" },
    { frame: 174, name: "03-kw-stagger-b" },
    { frame: 188, name: "04-kw-stagger-c" },
    { frame: 210, name: "05-stat-settled" },
  ];
  const outs = await renderStills({ props, publicDir: mkdtempSync(join(tmpdir(), "flex-")), format: "9:16", frames, outDir });
  console.log("stills:\n" + outs.join("\n"));
}
