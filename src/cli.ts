import { Command } from "commander";

const program = new Command();
program.name("kino").description("Agent-driven short-form video production").version("0.1.0");

program
  .command("build <spec>")
  .description("Generate a video from a spec (vo → avatar → render)")
  .option("--mock", "skip all paid APIs (silent VO + placeholder avatar)")
  .option("--format <list>", "comma-separated formats, e.g. 9:16,3:4")
  .option("--provider <name>", "override avatar engine: none | heygen | hedra | replicate")
  .action(async (s, o) => {
    await (await import("./commands/build.js")).build(s, o);
  });

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
  .command("init [brand]")
  .description("Scaffold .env, a brand config, and project dirs")
  .action(async (b) => (await import("./commands/init.js")).init(b));

program
  .command("doctor")
  .description("Check environment (deps + keys)")
  .action(async () => (await import("./commands/doctor.js")).doctor());

program.parseAsync(process.argv);
