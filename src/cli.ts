// CLI entry: registers every command with Commander, version read from package.json (version.ts).
// Each action uses a lazy `await import("./commands/x.js")` ON PURPOSE — it
// keeps startup fast (only the invoked command's module + its heavy deps like the render engine load) and
// isolates a broken command from crashing the whole CLI. Not a mistake; do not hoist these to
// top-level imports.
import { Command } from "commander";
import { log } from "./log.js";
import { formatCliError } from "./cliError.js";
import { KINO_VERSION } from "./version.js";

const program = new Command();
program.name("kino").description("Agent-driven short-form video production").version(KINO_VERSION);

program
  .command("build <spec>")
  .description("Generate a video from a spec (vo → avatar → render)")
  .option("--mock", "skip all paid APIs (silent VO + placeholder avatar)")
  .option("--format <list>", "comma-separated formats, e.g. 9:16,3:4,16:9")
  .option("--provider <name>", "override avatar engine: none | heygen | hedra | replicate")
  .option("--background <kind>", "override faceless background: glow|image|mesh|aurora|particles|grid|custom")
  .option("--font <name>", "override brand.font for this render (see `kino fonts`)")
  .option("--project <name>", "use projects/<name> (else inferred from the spec's path)")
  .option("--tag <label>", "suffix the output filename so variants are kept (auto-set from --background/--font)")
  .option("--draft", "force Eevee drafts for every 3D scene beat (fast iterate)")
  .action(async (s, o) => {
    await (await import("./commands/build.js")).build(s, o);
  });

program
  .command("inspect <spec>")
  .description("Print the resolved render plan (beats, timings) as JSON")
  .option("--real", "use real VO timings instead of the mock estimate")
  .option("--project <name>", "use projects/<name> (else inferred from the spec's path)")
  .action(async (s, o) => (await import("./commands/inspect.js")).inspect(s, o));

program
  .command("projects")
  .description("List projects, or scaffold one: --new <name> [--brand <brand>]")
  .option("--new <name>", "scaffold a new project under projects/")
  .option("--brand <brand>", "brand to assign to the new project (omit for kino defaults)")
  .action(async (o) => (await import("./commands/projects.js")).projects(o));

program
  .command("update")
  .description("Update kino in place (repo install: git pull + rebuild; global: npm -g @latest)")
  .action(async () => (await import("./commands/update.js")).update());

program
  .command("still <spec>")
  .description("Render still(s) fast (no encode): --at | --segment | --around <sec> | (per beat)")
  .option("--at <list>", "comma-separated timestamps in seconds")
  .option("--around <sec>", "N frames in a window around this timestamp (implies montage sheet)")
  .option("--span <sec>", "window width for --around (default 1)")
  .option("--count <n>", "frames in the --around window (default 5)")
  .option("--montage", "tile multiple stills into one contact sheet")
  .option("--segment <n>", "render the midpoint of segment n")
  .option("--word <word>", "center the sheet on a spoken word's start (with --segment; implies montage)")
  .option("--format <fmt>", "9:16, 3:4, or 16:9")
  .option("--font <name>", "override brand.font (see `kino fonts`)")
  .option("--project <name>", "use projects/<name> (else inferred from the spec's path)")
  .option("--real", "real VO/avatar + true timing (default: mock, free)")
  .option("--platform <name>", "overlay in-feed safe zones: tiktok | reels | shorts")
  .option("--grid", "overlay a rule-of-thirds grid for composition QA")
  .option("--final", "Cycles finals for 3D beats (default: Eevee draft)")
  .action(async (s, o) => (await import("./commands/still.js")).still(s, o));

program
  .command("storyboard <spec>")
  .description("Render per-beat stills (composition + full reveal), tiled into a labeled contact sheet")
  .option("--format <fmt>", "9:16, 3:4, or 16:9")
  .option("--frames <n>", "frames per beat (default 2: composition + fully-revealed end-state; the ·full tile shows overflow/overlaps)")
  .option("--font <name>", "override brand.font (see `kino fonts`)")
  .option("--project <name>", "use projects/<name> (else inferred from the spec's path)")
  .option("--real", "real VO/avatar + true timing (default: mock, free)")
  .option("--platform <name>", "overlay in-feed safe zones: tiktok | reels | shorts")
  .option("--final", "Cycles finals for 3D beats (default: Eevee draft)")
  .action(async (s, o) => (await import("./commands/storyboard.js")).storyboard(s, o));

program
  .command("frames <video>")
  .description("Extract frames from any video — --at | --around <sec> | --count/--every")
  .option("--at <list>", "comma-separated timestamps in seconds")
  .option("--around <sec>", "N frames in a window around this timestamp (implies montage sheet)")
  .option("--span <sec>", "window width for --around (default 1)")
  .option("--out <dir>", "output directory")
  .option("--montage", "also tile the frames into one image")
  .option("--every <sec>", "a frame every N seconds (when --at/--around is not given)")
  .option("--count <n>", "with --around: frames in the window (default 5); else N frames spaced evenly")
  .action(async (v, o) => (await import("./commands/frames.js")).frames(v, o));

program
  .command("transcribe <video>")
  .description("Analyse an EXTERNAL reference video: transcribe speech to a timestamped transcript (research only — NOT for our own renders or the build pipeline)")
  .option("--format <fmt>", "json | srt | vtt | text", "json")
  .option("--out <file>", "write to a file instead of stdout")
  .option("--mock", "offline canned transcript (no ffmpeg/network)")
  .action(async (v, o) => {
    await (await import("./commands/transcribe.js")).transcribe(v, o);
  });

program
  .command("scan <video>")
  .description("Analyse an EXTERNAL reference video: transcript + frames + contact sheet in one shot (research only)")
  .option("--count <n>", "extract N frames evenly (default: one per transcript segment)")
  .option("--every <sec>", "extract a frame every N seconds")
  .option("--out <dir>", "output directory")
  .option("--mock", "offline canned transcript")
  .action(async (v, o) => {
    await (await import("./commands/scan.js")).scan(v, o);
  });

program
  .command("audio-markers <file>")
  .description("Analyze any audio/video file: JSON markers (onsets, peaks, silences, RMS) + waveform/spectrogram PNGs")
  .option("--out <dir>", "output directory (default: next to the input file)")
  .action(async (f, o) => (await import("./commands/audiomarkers.js")).audioMarkers(f, o));

program
  .command("retune <spec>")
  .description("Rewrite motion/background triggers from real VO word timings (speech-synced UIs)")
  .option("--dry-run", "print changes without writing the spec")
  .option("--project <name>", "use projects/<name> (else inferred from the spec's path)")
  .action(async (s, o) => (await import("./commands/retune.js")).retune(s, { dryRun: o.dryRun, project: o.project }));

program
  .command("batch <input>")
  .description('Render many specs — JSON array of paths, or { "base", "variants": [{ "tag", "set" }] }')
  .option("--mock")
  .option("--project <name>", "use projects/<name> (else inferred from each spec's path)")
  .action(async (s, o) => (await import("./commands/batch.js")).batch(s, o));

program
  .command("voices")
  .description("List ElevenLabs voices")
  .option("--gender <g>")
  .action(async (o) => (await import("./commands/voices.js")).voices(o));

program
  .command("avatars")
  .description("List Avatar-IV photo-avatar looks (usable for lip-sync)")
  .option("--gender <g>")
  .action(async (o) => (await import("./commands/avatars.js")).avatars(o));

program
  .command("pexels <query>")
  .description("Search Pexels stock videos (portrait by default); --get <n> downloads into assets/pexels/")
  .option("--get <n>", "download result #n from the search")
  .option("--count <n>", "results to list (default 8)")
  .option("--landscape", "search landscape instead of portrait")
  .option("--out <rel>", "asset-relative output path (default pexels/<id>.mp4)")
  .option("--project <name>", "target project whose assets/ receives the download (required for --get)")
  .action(async (q, o) => (await import("./commands/pexels.js")).pexels(q, o));

program
  .command("photos <query>")
  .description("Search Pexels stock photos (portrait by default); --get <n> downloads into assets/pexels/")
  .option("--get <n>", "download result #n from the search")
  .option("--count <n>", "results to list (default 8)")
  .option("--landscape", "search landscape instead of portrait")
  .option("--out <rel>", "asset-relative output path (default pexels/<id>.jpg)")
  .option("--project <name>", "target project whose assets/ receives the download (required for --get)")
  .action(async (q, o) => (await import("./commands/photos.js")).photos(q, o));

program
  .command("music [query]")
  .description(
    "List bundled beds, or search Freesound CC0 (15–90s short-form). Bare ids work in specs.",
  )
  .option("--get [n]", "copy a bundled bed, or download Freesound result #n")
  .option("--count <n>", "Freesound results to list (default 8)")
  .option("--project <name>", "target project for --get")
  .action(async (q, o) => (await import("./commands/music.js")).music(q, o));

program
  .command("fonts")
  .description("List the curated fonts (downloaded on demand) with descriptions + cache status")
  .action(async () => (await import("./commands/fonts.js")).fonts());

program
  .command("backgrounds")
  .description("List animated backgrounds + their agent-controllable params/actions")
  .action(async () => (await import("./commands/backgrounds.js")).backgrounds());

program
  .command("elements")
  .description("List overlay elements (logo …) + their layout/tween controls")
  .action(async () => (await import("./commands/elements.js")).elements());

program
  .command("motion")
  .description("Show how to author motion-graphic HTML files + the CSS-variable contract")
  .action(async () => (await import("./commands/motion.js")).motion());

program
  .command("brand [name]")
  .description("List brands, or print a brand's styling values + markdown guidelines")
  .action(async (name) => (await import("./commands/brand.js")).brand(name));

program
  .command("init [brand]")
  .description("Scaffold .env, a brand, and a first project under projects/<brand>")
  .action(async (b) => (await import("./commands/init.js")).init(b));

program
  .command("doctor")
  .description("Check environment (deps + keys)")
  .action(async () => (await import("./commands/doctor.js")).doctor());

program
  .command("skills")
  .description("List bundled agent skills, or install them for Cursor / Claude / Codex / .agents")
  .option("--install", "symlink (or copy) package skills/ into each agent’s project skill dir")
  .option(
    "--agents <list>",
    "comma-separated targets: agents,cursor,claude,codex (default: all). Alias: claude-code→claude",
  )
  .action(async (o) => (await import("./commands/skills.js")).skills(o));

program.parseAsync(process.argv).catch((err) => {
  // One clean line instead of an uncaught stack dump on every expected failure (bad spec, missing
  // brand, lint violation…). Full stack still available with KINO_DEBUG=1.
  log.error(formatCliError(err));
  if (process.env.KINO_DEBUG) console.error(err);
  process.exit(1);
});
