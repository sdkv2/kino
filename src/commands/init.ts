import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { resolveWorkspace } from "../config/project.js";
import { installAllSkills } from "../config/skills.js";
import { log } from "../log.js";

// Scaffold a workspace + a first project named after the brand. kino requires a project, so init
// produces a ready-to-build one: brands/<brand>/brand.md, .env, and projects/<brand>/ with specs/,
// assets/, out/, and a project.json that assigns the brand.
export async function init(brand = "default"): Promise<void> {
  const ws = resolveWorkspace();
  const projectRoot = join(ws.workspaceRoot, "projects", brand);
  for (const d of [
    ws.brandDir(brand),
    join(projectRoot, "assets", "screens"),
    join(projectRoot, "assets", "recordings"),
    join(projectRoot, "specs"),
    join(projectRoot, "out"),
  ]) {
    mkdirSync(d, { recursive: true });
  }
  const envf = join(ws.workspaceRoot, ".env");
  if (!existsSync(envf)) {
    writeFileSync(
      envf,
      [
        "ELEVENLABS_API_KEY=",
        "HEYGEN_API_KEY=",
        "PEXELS_API_KEY=",
        "FREESOUND_API_KEY=",
        "",
      ].join("\n"),
    );
  }
  const cfg = join(projectRoot, "project.json");
  if (!existsSync(cfg)) writeFileSync(cfg, JSON.stringify({ brand }, null, 2) + "\n");
  const bf = join(ws.brandDir(brand), "brand.md");
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
        "## Tone / Voice",
        "",
        "- **Register:** (casual | plain | sharp | warm | dry)",
        "- **Person:** (you | we | they)",
        "- **Pace:** (punchy | measured)",
        "- **Energy:** (low | medium | high)",
        "- **Proof style:** (specific numbers | social proof | demo-first | none)",
        "- **CTA style:** (direct | soft recommend | urgency)",
        "- **Say like this:** (2–4 on-voice sample lines — real product truth)",
        "- **Never say like this:** (2–4 off-voice lines — same claim, wrong tone)",
        "- **Banned (brand):** (phrases this brand never uses)",
        "- **Preferred words:** (product nouns/verbs you actually say)",
        "",
        "_Fill Tone / Voice before mass-producing specs. Agents follow `ad-voice` skill._",
        "",
        "## Look",
        "",
        "- Palette usage, gradients, what to avoid",
        "",
        "## Captions",
        "",
        "- Phrase vs word-by-word; what to emphasise",
        "",
        "_All frontmatter is optional; anything omitted uses kino defaults._",
        "",
      ].join("\n"),
    );
  }
  const skillResults = installAllSkills(ws.workspaceRoot);
  const skillOk = skillResults.filter((r) => r.status !== "missing-source");
  if (skillOk.length) {
    const names = [...new Set(skillOk.map((r) => r.name))];
    const agents = [...new Set(skillOk.map((r) => r.agent))];
    log.ok(`Agent skills → ${agents.join(", ")} (${names.join(", ")})`);
  } else {
    log.warn("No bundled skills found to install — check the kino package's skills/ directory.");
  }

  log.ok(
    `Initialised project '${brand}'. Fill .env + brands/${brand}/brand.md, add specs under ` +
      `projects/${brand}/specs/, then: kino build projects/${brand}/specs/<spec>.json`,
  );
}
