import { Command } from "commander";

const program = new Command();
program.name("kino").description("Agent-driven short-form video production").version("1.4.0");

program
  .command("build <spec>")
  .description("Generate a video from a spec (vo → avatar → render)")
  .option("--mock", "skip all paid APIs (silent VO + placeholder avatar)")
  .option("--format <list>", "comma-separated formats, e.g. 9:16,3:4")
  .option("--provider <name>", "override avatar engine: none | heygen | hedra | replicate")
  .option("--background <kind>", "override faceless background: glow|image|mesh|aurora|particles|grid|custom")
  .option("--tag <label>", "suffix the output filename so variants are kept (auto-set from --background)")
  .action(async (s, o) => {
    await (await import("./commands/build.js")).build(s, o);
  });

program
  .command("inspect <spec>")
  .description("Print the resolved render plan (beats, timings) as JSON")
  .option("--real", "use real VO timings instead of the mock estimate")
  .action(async (s, o) => (await import("./commands/inspect.js")).inspect(s, o));

program
  .command("still <spec>")
  .description("Render a single frame fast (no encode): --at <sec> | --segment <n> | (per beat)")
  .option("--at <list>", "comma-separated timestamps in seconds")
  .option("--segment <n>", "render the midpoint of segment n")
  .option("--format <fmt>", "9:16 or 3:4")
  .option("--real", "real VO/avatar + true timing (default: mock, free)")
  .action(async (s, o) => (await import("./commands/still.js")).still(s, o));

program
  .command("storyboard <spec>")
  .description("Render one still per beat, tiled into a labeled contact sheet")
  .option("--format <fmt>", "9:16 or 3:4")
  .option("--real", "real VO/avatar + true timing (default: mock, free)")
  .action(async (s, o) => (await import("./commands/storyboard.js")).storyboard(s, o));

program
  .command("frames <video>")
  .description("Extract frames from a rendered video at given timestamps")
  .option("--at <list>", "comma-separated timestamps in seconds")
  .option("--out <dir>", "output directory")
  .option("--montage", "also tile the frames into one image")
  .action(async (v, o) => (await import("./commands/frames.js")).frames(v, o));

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
  .command("fonts")
  .description("List the curated fonts (downloaded on demand) with descriptions + cache status")
  .action(async () => (await import("./commands/fonts.js")).fonts());

program
  .command("init [brand]")
  .description("Scaffold .env, a brand config, and project dirs")
  .action(async (b) => (await import("./commands/init.js")).init(b));

program
  .command("doctor")
  .description("Check environment (deps + keys)")
  .action(async () => (await import("./commands/doctor.js")).doctor());

program.parseAsync(process.argv);
