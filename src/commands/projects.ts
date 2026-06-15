import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveProject } from "../config/project.js";
import { ProjectConfigSchema } from "../config/projectConfig.js";

// List projects (name → assigned brand), or scaffold one with --new <name> --brand <brand>.
export async function projects(opts: { new?: string; brand?: string }): Promise<void> {
  const { workspaceRoot } = resolveProject({});
  const projectsDir = join(workspaceRoot, "projects");

  if (opts.new) {
    if (!opts.brand) throw new Error("kino projects --new <name> requires --brand <brand>");
    const dir = join(projectsDir, opts.new);
    mkdirSync(join(dir, "specs"), { recursive: true });
    mkdirSync(join(dir, "assets"), { recursive: true });
    const cfg = join(dir, "project.json");
    if (!existsSync(cfg)) writeFileSync(cfg, JSON.stringify({ brand: opts.brand }, null, 2) + "\n");
    process.stdout.write(`✓ project '${opts.new}' (brand: ${opts.brand}) → ${dir}\n`);
    return;
  }

  if (!existsSync(projectsDir)) {
    process.stdout.write("No projects yet. Create one: kino projects --new <name> --brand <brand>\n");
    return;
  }
  process.stdout.write("Projects:\n");
  for (const name of readdirSync(projectsDir).sort()) {
    const cfg = join(projectsDir, name, "project.json");
    if (!existsSync(cfg)) continue;
    let brand = "?";
    try {
      brand = ProjectConfigSchema.parse(JSON.parse(readFileSync(cfg, "utf8"))).brand;
    } catch {
      brand = "(invalid project.json)";
    }
    process.stdout.write(`  ${name.padEnd(22)} brand: ${brand}\n`);
  }
}
