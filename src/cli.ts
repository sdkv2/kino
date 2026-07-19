// CLI entry: registers every command with Commander and version (literal in cli.ts, kept in sync
// with package.json). Each action uses a lazy `await import("./commands/x.js")` ON PURPOSE — it
// keeps startup fast (only the invoked command's module + its heavy deps like Remotion load) and
// isolates a broken command from crashing the whole CLI. Not a mistake; do not hoist these to
// top-level imports.
import { Command } from "commander";
import { log } from "./log.js";
import { formatCliError } from "./cliError.js";

const program = new Command();
program.name("kino").description("Agent-driven short-form video production").version("1.17.1");

program
  .command("build <spec>")
  .description("Generate a video from a spec (vo → avatar → render)")
  .option("--mock", "skip all paid APIs (silent VO + placeholder avatar)")
  .option("--format <list>", "comma-separated formats, e.g. 9:16,3:4")
  .option("--provider <name>", "override avatar engine: none | heygen | hedra | replicate")
  .option("--background <kind>", "override faceless background: glow|image|mesh|aurora|particles|grid|custom")
  .option("--font <name>", "override brand.font for this render (see `kino fonts`)")
  .option("--project <name>", "use projects/<name> (else inferred from the spec's path)")
  .option("--tag <label>", "suffix the output filename so variants are kept (auto-set from --background/--font)")
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
  .description("List projects, or scaffold one: --new <name> --brand <brand>")
  .option("--new <name>", "scaffold a new project under projects/")
  .option("--brand <brand>", "brand to assign to the new project")
  .action(async (o) => (await import("./commands/projects.js")).projects(o));

program
  .command("still <spec>")
  .description("Render a single frame fast (no encode): --at <sec> | --segment <n> | (per beat)")
  .option("--at <list>", "comma-separated timestamps in seconds")
  .option("--segment <n>", "render the midpoint of segment n")
  .option("--format <fmt>", "9:16 or 3:4")
  .option("--font <name>", "override brand.font (see `kino fonts`)")
  .option("--project <name>", "use projects/<name> (else inferred from the spec's path)")
  .option("--real", "real VO/avatar + true timing (default: mock, free)")
  .action(async (s, o) => (await import("./commands/still.js")).still(s, o));

program
  .command("storyboard <spec>")
  .description("Render one still per beat, tiled into a labeled contact sheet")
  .option("--format <fmt>", "9:16 or 3:4")
  .option("--font <name>", "override brand.font (see `kino fonts`)")
  .option("--project <name>", "use projects/<name> (else inferred from the spec's path)")
  .option("--real", "real VO/avatar + true timing (default: mock, free)")
  .action(async (s, o) => (await import("./commands/storyboard.js")).storyboard(s, o));

program
  .command("frames <video>")
  .description("Extract frames from any video — explicit timestamps, or evenly via --count/--every")
  .option("--at <list>", "comma-separated timestamps in seconds")
  .option("--out <dir>", "output directory")
  .option("--montage", "also tile the frames into one image")
  .option("--every <sec>", "a frame every N seconds (when --at is not given)")
  .option("--count <n>", "N frames spaced evenly (when --at is not given)")
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
  .command("batch <input>")
  .description("Render many specs (JSON array of spec paths)")
  .option("--mock")
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

program.parseAsync(process.argv).catch((err) => {
  // One clean line instead of an uncaught stack dump on every expected failure (bad spec, missing
  // brand, lint violation…). Full stack still available with KINO_DEBUG=1.
  log.error(formatCliError(err));
  if (process.env.KINO_DEBUG) console.error(err);
  process.exit(1);
});
