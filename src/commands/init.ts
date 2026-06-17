import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { resolveProject } from "../config/project.js";
import { log } from "../log.js";

export async function init(brand = "default"): Promise<void> {
  const p = resolveProject();
  for (const d of [p.brandDir(brand), p.assetPath("screens"), p.assetPath("recordings"), join(p.projectRoot, "specs"), join(p.projectRoot, "out")]) {
    mkdirSync(d, { recursive: true });
  }
  const envf = join(p.workspaceRoot, ".env");
  if (!existsSync(envf)) writeFileSync(envf, "ELEVENLABS_API_KEY=\nHEYGEN_API_KEY=\n");
  const bf = join(p.brandDir(brand), "brand.md");
  if (!existsSync(bf)) {
    writeFileSync(
      bf,
      [
        "---",
        `name: ${brand}`,
        'colors: { night: "#0b1020", mint: "#80e2b4", green: "#0c8d64" }',
        "# disclosure: AI-generated   # optional — shown on every video when set",
        "# defaultVoice: <elevenlabs-voice-id>   # or set per spec",
        "bannedPhrases: [get the job, guaranteed interview, land more interviews]",
        "---",
        `# ${brand} — brand guidelines`,
        "",
        "- Voice: (describe tone — e.g. confident, plain-spoken, short sentences)",
        "- Look: (palette usage, gradients, what to avoid)",
        "- Captions: (phrase vs word-by-word; what to emphasise)",
        "",
        "_All frontmatter is optional; anything omitted uses kino defaults._",
        "",
      ].join("\n"),
    );
  }
  log.ok(`Initialised brand '${brand}'. Fill .env and brands/${brand}/brand.md, then add assets/specs.`);
}
