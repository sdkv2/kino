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
  const bf = join(p.brandDir(brand), "brand.json");
  if (!existsSync(bf)) {
    writeFileSync(
      bf,
      JSON.stringify(
        {
          name: brand,
          colors: { night: "#0b1020", mint: "#80e2b4", green: "#0c8d64" },
          disclosure: "AI avatar & voice · sample data",
          bannedPhrases: ["get the job", "guaranteed interview", "land more interviews"],
          defaultVoice: "",
          defaultLook: "",
          voiceAliases: {},
          lookAliases: {},
        },
        null,
        2,
      ),
    );
  }
  log.ok(`Initialised brand '${brand}'. Fill .env, brand.json, and add assets/specs.`);
}
