// Two beats, two solvers — the two halves of the solver stdlib, side by side.
//
// Beat 1 CONVERGES (d3-force): nodes drifting toward targets and finding their groups.
// Beat 2 is 3D (hand-written solver): panels tumbling through depth and locking onto a wall.
//
// Both are the same pathway: a stateful solve at BUILD time, replayed by a pure `(env) => string`,
// leaving the render as resumable and as shardable as it ever was.
//
// Run: `npx tsx examples/motion-sim/render-sim.ts`   (set SIM_VIDEO=1 for the mp4 instead of stills)
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { renderStills, renderVideo } from "../../src/render/render.js";
import { resolveMotionGraphic } from "../../src/render/motiongraphic.js";
import { PALETTE_PRESETS } from "../../src/config/palettes.js";
import type { KinoProps } from "../../src/render/props.js";

const here = dirname(fileURLToPath(import.meta.url));
const project = { assetPath: (rel: string) => join(here, rel) };

const FPS = 30;
const DUR_SEC = 3;
const BEATS = 2;
const [W, H] = [1080, 1920];

// Role names, not the legacy literal ones: the graphic paints from `--kino-surface` / `--kino-ok` /
// `--kino-muted`, and those are DERIVED from bg/fg/accent/accent2/deep. A theme carrying only the
// pre-rename aliases would leave them with nothing to derive from.
const theme = {
  font: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  ...PALETTE_PRESETS.midnight,
  captionFontSize: 74,
  captionStroke: 9,
};

// What a solver needs and a spec cannot know: the beat's real length in frames (after TTS has had
// its say), the rate it integrates on, and the canvas it works in. `kino build` derives this per
// beat; here there is one beat, so it is written out.
const simCtx = { frames: DUR_SEC * FPS, fps: FPS, width: W, height: H };

const props: KinoProps = {
  theme,
  fps: FPS,
  avatar: null,
  avatarWindows: [],
  voTrack: null,
  background: {
    kind: "glow",
    image: null,
    customCode: null,
    shaderCode: null,
    params: {},
    keyframes: [],
    triggers: [],
  },
  disclosure: "",
  // NO BLOOM, deliberately. It was here and it had to go: a full-frame bloom cannot tell type from
  // a highlight, so it smeared a halo around every glyph in the headline, and `halation` — which
  // gives that bloom a per-channel radius so red bleeds furthest — turned the halo orange. On a
  // photographed highlight that is the effect working; on synthetic UI type it reads as a rendering
  // fault. Isolated by rendering the same frame with each stage removed in turn: the halo tracked
  // bloom exactly, and the type is clean without it.
  //
  // Nothing was lost. The glow that matters here belongs to ELEMENTS — the hero's aura and the
  // landing glints are box-shadows on the panels themselves, which is where glow belongs in a
  // synthetic composition, and they survive untouched.
  //
  // `veil` stays: it is the content-responsive glare, it measures the frame rather than the glyphs,
  // and it lifts the blacks evenly instead of ringing anything. `film` stays for grain, so the flat
  // CSS gradients read as photographed.
  postFx: {
    veil: { amount: 0.045, threshold: 0.05 },
    film: { intensity: 0.42, grain: 0.9, grainSize: 1.4 },
  },
  segments: [
    {
      kind: "motion",
      caption: "",
      startSec: 0,
      endSec: DUR_SEC,
      motion: resolveMotionGraphic(
        { source: "cluster.js", sim: { source: "cluster.sim.js" } },
        project,
        simCtx,
      ),
    },
    {
      kind: "motion",
      caption: "",
      startSec: DUR_SEC,
      endSec: DUR_SEC * 2,
      motion: resolveMotionGraphic(
        { source: "panels.js", sim: { source: "panels.sim.js" } },
        project,
        simCtx,
      ),
    },
  ],
};

const outDir = join(here, "out");
mkdirSync(outDir, { recursive: true });

if (process.env.SIM_VIDEO) {
  const outs = await renderVideo({
    props,
    publicDir: mkdtempSync(join(tmpdir(), "msim-")),
    formats: ["9:16"],
    outDir,
    title: "motion-sim",
  });
  console.log("video:", outs.join(", "));
} else {
  // Four points along the solve — scattered, converging, nearly settled, settled. A still at one
  // frame proves nothing here: the whole claim is that the state ADVANCES.
  const frames = [
    { frame: 2, name: "s01-scattered" },
    { frame: 14, name: "s02-converging" },
    { frame: 40, name: "s03-nearly" },
    { frame: 85, name: "s04-settled" },
    // Beat 2 starts at frame 90. Sampled clear of the motion→motion dissolve, which otherwise
    // superimposes the outgoing beat and makes the still unreadable.
    { frame: 112, name: "s05-swarm" },
    { frame: 122, name: "s06-arriving" },
    { frame: 145, name: "s07-locking" },
    { frame: 178, name: "s08-wall" },
    // Beat-2 frames where a panel is MEASURED to be crossing edge-on (33/37 = panel 6, 53 = panel
    // 9, 58 = panel 10). Sampling the turn itself, rather than hoping a general still catches one.
    { frame: 123, name: "t1-turn" },
    { frame: 127, name: "t2-turn" },
    { frame: 143, name: "t3-turn" },
    { frame: 148, name: "t4-turn" },
  ];
  const outs = await renderStills({
    props,
    publicDir: mkdtempSync(join(tmpdir(), "msim-")),
    format: "9:16",
    frames,
    outDir,
  });
  console.log("stills:\n" + outs.join("\n"));
}
