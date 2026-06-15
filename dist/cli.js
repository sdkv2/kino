import { Command } from "commander";
const program = new Command();
program.name("kino").description("Agent-driven short-form video production").version("0.1.0");
program.command("doctor").description("Check environment").action(async () => {
    const { doctor } = await import("./commands/doctor.js");
    await doctor();
});
program.parseAsync(process.argv);
