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
  // Beats overlap ~0.3s so each crossfades into the next; every animation finishes well before the
  // beat ends (entrances + the count done by ~60%), leaving a clear settled hold before the crossfade.
  segments: [
    {
      kind: "motion",
      caption: "",
      startSec: 0,
      endSec: 5.0,
      motion: resolveMotionGraphic(
        {
          source: "hero.html",
          // kicker/rule/sub ease in via spec params; the headline lines use scrubbed @keyframes
          // (.kino-anim) so they need no --t1/--t2 params at all.
          params: { gold: GOLD, kick: 0, rule: 0, sub: 0 },
          keyframes: [
            { at: 0.1, params: { kick: 0 } }, { at: 1.1, params: { kick: 1 }, ease: "easeInOut" },
            { at: 1.0, params: { rule: 0 } }, { at: 2.1, params: { rule: 1 }, ease: "easeInOut" },
            { at: 1.3, params: { sub: 0 } }, { at: 2.3, params: { sub: 1 }, ease: "easeInOut" },
          ],
          triggers: [{ at: 0.2, action: "pulse" }, { at: 2.3, action: "pulse" }],
        },
        project,
      ),
    },
    {
      kind: "motion",
      caption: "",
      startSec: 4.7,
      endSec: 10.0,
      motion: resolveMotionGraphic(
        {
          source: "stat.html",
          // entrance staggered in CSS off --progress; the count finishes by ~60% so it holds at 98%.
          params: { pct: 0, gold: GOLD },
          keyframes: [
            { at: 0.7, params: { pct: 0 } }, { at: 3.2, params: { pct: 98 }, ease: "easeInOut" },
          ],
          triggers: [{ at: 0.5, action: "pulse" }, { at: 3.2, action: "pulse" }],
        },
        project,
      ),
    },
    {
      kind: "motion",
      caption: "",
      startSec: 9.7,
      endSec: 14.7,
      motion: resolveMotionGraphic(
        {
          source: "orbit.html",
          params: { gold: GOLD, enter: 0 },
          keyframes: [{ at: 0.1, params: { enter: 0 } }, { at: 1.5, params: { enter: 1 }, ease: "easeInOut" }],
          triggers: [{ at: 0.4, action: "pulse" }, { at: 2.4, action: "pulse" }, { at: 4.0, action: "pulse" }],
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
  const frames = [
    { frame: 30, name: "01-hero-blur-rise" },   // headline @keyframes blur+rise, staggered
    { frame: 100, name: "02-hero-hold" },        // settled hold: rule, sub, beat dots, vignette
    { frame: 175, name: "03-stat-kw-stagger" },  // keywords @keyframes staggering, number gradient
    { frame: 250, name: "04-stat-count-hold" },  // count holds at 98%, bar sheen, beat dots
    { frame: 345, name: "05-orbit-mark-pop" },   // wordmark @keyframes pop, dots orbiting
    { frame: 410, name: "06-orbit-hold" },
  ];
  const outs = await renderStills({ props, publicDir: mkdtempSync(join(tmpdir(), "flex-")), format: "9:16", frames, outDir });
  console.log("stills:\n" + outs.join("\n"));
}
