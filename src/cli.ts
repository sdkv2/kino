// CLI entry: registers every command with Commander, version read from package.json (version.ts).
// Each action uses a lazy `await import("./commands/x.js")` ON PURPOSE — it
// keeps startup fast (only the invoked command's module + its heavy deps like the render engine load) and
// isolates a broken command from crashing the whole CLI. Not a mistake; do not hoist these to
// top-level imports.
//
// Flags shared by more than one command come from cliOptions.ts so the same word always means the
// same thing; see that file for the vocabulary. Commands are registered in the order you use them
// (make something → look at it → fix the timing → fetch assets → look things up → set up), because
// that registration order is the order `kino --help` prints.
import { Command, Option } from "commander";
import { log } from "./log.js";
import { formatCliError } from "./cliError.js";
import { KINO_VERSION } from "./version.js";
import {
  aroundOpt,
  asOpt,
  assetNameOpt,
  atOpt,
  draftAnalysisOpt,
  draftOpt,
  dryRunOpt,
  firstOf,
  fontOpt,
  formatAliasOpt,
  formatListOpt,
  formatOneOpt,
  getOpt,
  landscapeOpt,
  mockAliasOpt,
  montageOpt,
  outAliasOpt,
  outDirOpt,
  platformOpt,
  projectOpt,
  projectTargetOpt,
  qualityOpt,
  realOpt,
  resultCountOpt,
  spanOpt,
} from "./cliOptions.js";

const program = new Command();
program.name("kino").description("Spec driven video development").version(KINO_VERSION);

/* ─── make ───────────────────────────────────────────────────────────────────────────────────── */

program
  .command("build <spec>")
  .description("Render a spec to MP4")
  .addOption(draftOpt())
  .addOption(new Option("--tts", "buy real voiceover from ElevenLabs — THE ONLY FLAG THAT SPENDS"))
  .addOption(realOpt())
  .addOption(new Option("--no-avatar", "with --tts: keep the voiceover, skip the presenter"))
  .addOption(formatListOpt())
  .addOption(qualityOpt())
  .addOption(new Option("--provider <name>", "override the presenter engine: none, heygen, hedra, replicate"))
  .addOption(new Option("--background <kind>", "override the background: glow, image, mesh, aurora, particles, grid, custom"))
  .addOption(fontOpt())
  .addOption(new Option("--beat <n>", "render only beat n (1-indexed) as its own clip"))
  .addOption(new Option("--tag <label>", "suffix the output filename so variants are kept"))
  .addOption(projectOpt())
  .addOption(mockAliasOpt())
  .action(async (s, o) => {
    await (await import("./commands/build.js")).build(s, o);
  });

program
  .command("batch <input>")
  .description('Render many specs, or one spec in many variants — a JSON array of paths, or { "base", "variants" }')
  .addOption(draftOpt())
  .addOption(projectOpt())
  .addOption(mockAliasOpt())
  .action(async (s, o) =>
    (await import("./commands/batch.js")).batch(s, { mock: !!(o.draft || o.mock), project: o.project }),
  );

/* ─── look at it ─────────────────────────────────────────────────────────────────────────────── */

program
  .command("still <spec>")
  .description("Render single frames from a spec — no video encode, so it is fast")
  .addOption(atOpt())
  .addOption(new Option("--segment <list>", "render the midpoint of beat n (comma-separated for several)"))
  .addOption(aroundOpt())
  .addOption(spanOpt())
  .addOption(new Option("--count <n>", "how many frames in the --around window (default 5)"))
  .addOption(new Option("--word <word>", "centre the window on a spoken word (needs --segment)"))
  .addOption(montageOpt())
  .addOption(realOpt())
  .addOption(formatOneOpt())
  .addOption(fontOpt())
  .addOption(qualityOpt())
  .addOption(platformOpt())
  .addOption(new Option("--grid", "overlay a rule-of-thirds grid for composition checks"))
  .addOption(new Option("--measure", "print the exact geometry of every [data-measure] element"))
  .addOption(new Option("--dump-html", "write the markup each motion graphic emitted at these frames"))
  .addOption(projectOpt())
  .action(async (s, o) => (await import("./commands/still.js")).still(s, o));

program
  .command("storyboard <spec>")
  .description("Render one labelled frame per beat, tiled into a contact sheet")
  .addOption(new Option("--frames <n>", "how many frames per beat (default 2: composition, then fully revealed)"))
  .addOption(realOpt())
  .addOption(formatOneOpt())
  .addOption(fontOpt())
  .addOption(platformOpt())
  .addOption(projectOpt())
  .action(async (s, o) => (await import("./commands/storyboard.js")).storyboard(s, o));

program
  .command("inspect <spec>")
  .description("Print the resolved plan as JSON — beats, timings, and per-word timestamps")
  .addOption(realOpt())
  .addOption(projectOpt())
  .action(async (s, o) => (await import("./commands/inspect.js")).inspect(s, o));

program
  .command("frames <video>")
  .description("Extract frames from a video file")
  .addOption(atOpt())
  .addOption(aroundOpt())
  .addOption(spanOpt())
  .addOption(new Option("--count <n>", "how many frames — in the --around window, or spaced evenly (default 5)"))
  .addOption(new Option("--every <sec>", "a frame every n seconds, instead of --at/--around"))
  .addOption(montageOpt())
  .addOption(outDirOpt())
  .action(async (v, o) => (await import("./commands/frames.js")).frames(v, o));

/* ─── fix the timing ─────────────────────────────────────────────────────────────────────────── */

program
  .command("retune <spec>")
  .description("Rewrite motion triggers from the real voiceover's word timings")
  .addOption(dryRunOpt())
  .addOption(projectOpt())
  .action(async (s, o) => (await import("./commands/retune.js")).retune(s, { dryRun: o.dryRun, project: o.project }));

program
  .command("sync <spec>")
  .description("Retime beats so every cut lands on the music bed's beat grid")
  .addOption(new Option("--grain <g>", "snap cuts to every beat, or every bar (4 beats)").choices(["beat", "bar"]).default("bar"))
  .addOption(
    new Option("--offset <mode>", "auto picks the loudest on-grid music.startSec; keep leaves it alone")
      .choices(["auto", "keep"])
      .default("keep"),
  )
  .addOption(new Option("--min-dur <sec>", "shortest a rewritten beat may become").argParser(parseFloat))
  .addOption(dryRunOpt())
  .addOption(projectOpt())
  .action(async (s, o) => {
    await (await import("./commands/sync.js")).sync(s, {
      grain: o.grain,
      offset: o.offset,
      minDur: o.minDur,
      dryRun: o.dryRun,
      project: o.project,
    });
  });

program
  .command("audio-markers <file>")
  .description("Analyse an audio or video file — onsets, peaks, silences, plus waveform images")
  .addOption(outDirOpt())
  .action(async (f, o) => (await import("./commands/audiomarkers.js")).audioMarkers(f, o));

/* ─── fetch assets ───────────────────────────────────────────────────────────────────────────── */

program
  .command("pexels <query>")
  .description("Search Pexels for stock video clips (portrait by default) — for photos use `kino photos`")
  .addOption(getOpt())
  .addOption(resultCountOpt())
  .addOption(landscapeOpt())
  .addOption(assetNameOpt("pexels/<id>.mp4"))
  .addOption(projectTargetOpt())
  .addOption(outAliasOpt())
  .action(async (q, o) => (await import("./commands/pexels.js")).pexels(q, { ...o, out: firstOf(o.name, o.out) }));

program
  .command("photos <query>")
  .description("Search Pexels for stock photos (portrait by default) — for video use `kino pexels`")
  .addOption(getOpt())
  .addOption(resultCountOpt())
  .addOption(landscapeOpt())
  .addOption(assetNameOpt("pexels/<id>.jpg"))
  .addOption(projectTargetOpt())
  .addOption(outAliasOpt())
  .action(async (q, o) => (await import("./commands/photos.js")).photos(q, { ...o, out: firstOf(o.name, o.out) }));

program
  .command("music [query]")
  .description("List the bundled music beds, or search Freesound for CC0 tracks")
  .addOption(new Option("--get [n]", "copy a bundled bed, or download Freesound result n"))
  .addOption(resultCountOpt())
  .addOption(projectTargetOpt())
  .action(async (q, o) => (await import("./commands/music.js")).music(q, o));

program
  .command("segment <input>")
  .description("Generate object masks from an image or video, for use as shader texture channels")
  .addOption(new Option("--prompt <text>", "text naming the object(s) to segment (required)"))
  .addOption(new Option("--objects <n>", "how many objects to track (max 4, default 1)"))
  .addOption(new Option("--name <name>", "output name under assets/masks/ (default: the input's basename)"))
  .addOption(new Option("--cutout", "images only: also write a transparent subject to assets/cutouts/"))
  .addOption(new Option("--no-mask", "images only: skip mask.png — pair with --cutout for a cutout only"))
  .addOption(new Option("--no-track", "segment each frame independently instead of tracking objects"))
  .addOption(new Option("--backend <name>", "coreml, cuda, or mock (default: coreml on macOS, else cuda)"))
  .addOption(asOpt(["json"]))
  .addOption(outAliasOpt())
  .addOption(formatAliasOpt())
  .action(async (input, o) => {
    await (await import("./commands/segment.js")).segment(input, {
      ...o,
      out: firstOf(o.name, o.out),
      format: firstOf(o.as, o.format),
    });
  });

/* ─── study a reference video (research only — never the input to our own renders) ───────────── */

program
  .command("transcribe <video>")
  .description("Transcribe someone else's reference video — research only, never a build input")
  .addOption(asOpt(["json", "srt", "vtt", "text"]))
  .addOption(new Option("--out <file>", "write to this file instead of stdout"))
  .addOption(draftAnalysisOpt())
  .addOption(mockAliasOpt())
  .addOption(formatAliasOpt())
  .action(async (v, o) => {
    await (await import("./commands/transcribe.js")).transcribe(v, {
      ...o,
      format: firstOf(o.as, o.format) ?? "json",
      mock: !!(o.draft || o.mock),
    });
  });

program
  .command("scan <video>")
  .description("Transcribe someone else's reference video and extract frames — research only")
  .addOption(new Option("--count <n>", "how many frames, spaced evenly (default: one per transcript segment)"))
  .addOption(new Option("--every <sec>", "a frame every n seconds"))
  .addOption(outDirOpt())
  .addOption(draftAnalysisOpt())
  .addOption(mockAliasOpt())
  .action(async (v, o) => {
    await (await import("./commands/scan.js")).scan(v, { ...o, mock: !!(o.draft || o.mock) });
  });

/* ─── look things up ─────────────────────────────────────────────────────────────────────────── */

program
  .command("brand [name]")
  .description("List brands, or print one brand's styling values and guidelines")
  .addOption(asOpt(["json"]))
  .action(async (name, o) => (await import("./commands/brand.js")).brand(name, o));

program
  .command("backgrounds")
  .description("List the animated backgrounds and the parameters each accepts")
  .addOption(asOpt(["json"]))
  .action(async (o) => (await import("./commands/backgrounds.js")).backgrounds(o));

program
  .command("colors")
  .description("List the stock colour schemes and the palette roles a spec/brand can set")
  .action(async () => (await import("./commands/colors.js")).colors());

program
  .command("elements")
  .description("List the overlay elements (caption, kicker, zoom …) and their layout controls")
  .addOption(asOpt(["json"]))
  .action(async (o) => (await import("./commands/elements.js")).elements(o));

program
  .command("transitions")
  .description("List the beat transitions, and how to author your own")
  .addOption(asOpt(["json"]))
  .action(async (o) => (await import("./commands/transitions.js")).transitions(o));

program
  .command("motion")
  .description("Print the contract for authoring motion-graphic HTML")
  .action(async () => (await import("./commands/motion.js")).motion());

program
  .command("fonts")
  .description("List the curated fonts, search Google Fonts, or render a specimen")
  .addOption(new Option("--search <term>", "search the full Google Fonts catalog (needs GOOGLE_FONTS_API_KEY)"))
  .addOption(new Option("--preview <family>", "render a caption specimen and print the paths"))
  .addOption(new Option("--brand <name>", "brand whose colours the preview uses (default: kino house)"))
  .addOption(new Option("--format <list>", "preview formats: 9:16, 3:4, 16:9 (comma-separated, default 9:16,16:9)"))
  .addOption(new Option("--refresh", "re-fetch the Google Fonts catalog instead of using the cached copy"))
  .addOption(asOpt(["json"]))
  .action(async (o) => (await import("./commands/fonts.js")).fonts(o));

program
  .command("glyphs <text>")
  .description("Print letterform outlines as SVG path data")
  .addOption(new Option("--font <name>", "any Google Fonts family (default Inter) — see `kino fonts`"))
  .addOption(new Option("--size <px>", "em size the outlines are scaled to (default 100)"))
  .addOption(new Option("--letter-spacing <px>", "extra advance per glyph, in the same units"))
  .addOption(new Option("--combined", "one path for the whole run instead of one per glyph"))
  .addOption(asOpt(["json"]))
  .addOption(new Option("--json", "deprecated alias of --as json").hideHelp())
  .action(async (text: string, o) =>
    (await import("./commands/glyphs.js")).glyphs(text, { ...o, json: o.json || o.as === "json" }),
  );

program
  .command("voices")
  .description("List the ElevenLabs voices")
  .addOption(new Option("--gender <g>", "filter by voice gender"))
  .addOption(asOpt(["json"]))
  .action(async (o) => (await import("./commands/voices.js")).voices(o));

program
  .command("avatars")
  .description("List the Avatar-IV photo-avatar looks usable for lip-sync")
  .addOption(new Option("--gender <g>", "filter by look gender"))
  .addOption(asOpt(["json"]))
  .action(async (o) => (await import("./commands/avatars.js")).avatars(o));

/* ─── set up ─────────────────────────────────────────────────────────────────────────────────── */

program
  .command("init [brand]")
  .description("Set up .env + a first project (naming a brand also scaffolds brands/<brand>/)")
  .action(async (b) => (await import("./commands/init.js")).init(b));

program
  .command("projects")
  .description("List the projects, or scaffold a new one")
  .addOption(new Option("--new <name>", "scaffold a new project under projects/"))
  .addOption(new Option("--brand <brand>", "brand to assign to the new project (omit — each spec then sets `colors`)"))
  .action(async (o) => (await import("./commands/projects.js")).projects(o));

program
  .command("doctor")
  .description("Check the environment — dependencies and API keys")
  .action(async () => (await import("./commands/doctor.js")).doctor());

program
  .command("skills")
  .description("List the bundled agent skills, or install them for Cursor / Claude / Codex")
  .addOption(new Option("--install", "symlink (or copy) the package's skills/ into each agent's skill dir"))
  .addOption(new Option("--agents <list>", "comma-separated targets: agents, cursor, claude, codex (default: all)"))
  .action(async (o) => (await import("./commands/skills.js")).skills(o));

program
  .command("update")
  .description("Update kino in place")
  .action(async () => (await import("./commands/update.js")).update());

program
  .parseAsync(process.argv)
  .then(() => {
    // Exit explicitly instead of waiting for the event loop to drain: the render host's
    // stdio/socket transport isn't reliably unref'd across versions/platforms, so a render
    // command can finish writing its output and then hang forever with no visible work
    // left to do.
    process.exit(0);
  })
  .catch((err) => {
    // One clean line instead of an uncaught stack dump on every expected failure (bad spec, missing
    // brand, lint violation…). Full stack still available with KINO_DEBUG=1.
    log.error(formatCliError(err));
    if (process.env.KINO_DEBUG) console.error(err);
    process.exit(1);
  });
