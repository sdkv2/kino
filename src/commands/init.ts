import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { resolveWorkspace } from "../config/project.js";
import { installAllSkills } from "../config/skills.js";
import { log } from "../log.js";
import { KINO_VERSION } from "../version.js";

// Scaffold a workspace + a ready-to-build first project: .env and projects/<name>/ with specs/,
// assets/, out/, and a project.json.
//
// A brand is only scaffolded when one is NAMED (`kino init acme`). Bare `kino init` produces a
// project whose sample spec carries `"colors": "midnight"` and no brands/ directory at all — a
// brand is for shared tone/voice, fonts, disclosures and voice aliases, not the price of admission
// for setting five colours.
export async function init(brand?: string): Promise<void> {
  const name = brand ?? "default";
  const ws = resolveWorkspace(process.cwd(), { create: true });
  const projectRoot = join(ws.workspaceRoot, "projects", name);
  for (const d of [
    ...(brand ? [ws.brandDir(brand)] : []),
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
  if (!existsSync(cfg)) writeFileSync(cfg, JSON.stringify(brand ? { brand } : {}, null, 2) + "\n");
  // A ready-to-build sample so the quickstart's first `kino build` works with no editing:
  // no presenter (provider none → no avatar spend), builds free with --mock. It carries `colors`
  // whether or not a brand exists — a spec that declares its own scheme is the shape to copy.
  const specf = join(projectRoot, "specs", "sample.json");
  if (!existsSync(specf)) {
    writeFileSync(
      specf,
      JSON.stringify(
        {
          title: "sample",
          kinoVersion: KINO_VERSION,
          provider: "none",
          background: "glow",
          colors: "midnight",
          segments: [
            {
              text: "This is a kino build — voice over a background, and no API spend in mock mode.",
              caption: "spec in, video out",
            },
            {
              text: "Edit this spec, then run kino build to render your first video.",
              caption: "edit, then render",
              cta: true,
            },
          ],
        },
        null,
        2,
      ) + "\n",
    );
  }
  const bf = brand ? join(ws.brandDir(brand), "brand.md") : null;
  if (bf && !existsSync(bf)) {
    writeFileSync(
      bf,
      [
        "---",
        `name: ${brand}`,
        '# colors: every spec in this project inherits these — drop the block to let each spec set',
        '# its own (a preset name or roles). Roles: bg, fg, accent, accent2, deep. `kino colors`.',
        'colors: { bg: "#0b1020", accent: "#80e2b4", deep: "#0c8d64" }',
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
    `Initialised project '${name}'. Fill .env${brand ? ` + brands/${brand}/brand.md` : ""}, then build the sample: ` +
      `kino build projects/${name}/specs/sample.json --mock` +
      (brand ? "" : "\n  The sample sets \"colors\": \"midnight\" — `kino colors` lists the schemes."),
  );
}
