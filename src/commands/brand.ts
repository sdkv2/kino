import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { resolveWorkspace } from "../config/project.js";
import { loadBrandDoc } from "../config/brand.js";

// Brand names = subdirs of brands/ that contain a brand.md.
export function listBrands(brandsRoot: string): string[] {
  if (!existsSync(brandsRoot)) return [];
  return readdirSync(brandsRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(brandsRoot, e.name, "brand.md")))
    .map((e) => e.name)
    .sort();
}

// Human-readable dump of a brand: resolved frontmatter values + the guidelines body.
export function brandText(brandDir: string): string {
  const { brand, body } = loadBrandDoc(brandDir);
  const lines = [
    `name: ${brand.name || "(unset)"}`,
    `colors: night ${brand.colors.night} · mint ${brand.colors.mint} · green ${brand.colors.green} · white ${brand.colors.white} · gold ${brand.colors.gold}`,
    `font: ${brand.font}`,
    `captionMode: ${brand.captionMode ?? "phrase (default)"}    background: ${brand.background ?? "glow (default)"}`,
    `voice: ${brand.defaultVoice ?? "(unset — set spec.voice)"}    disclosure: ${brand.disclosure || "(none)"}`,
    "",
    "— guidelines —",
    body.trim() || "(no guidelines body)",
    "",
  ];
  return lines.join("\n");
}

export async function brand(name?: string): Promise<void> {
  const ws = resolveWorkspace();
  const brandsRoot = join(ws.workspaceRoot, "brands");
  if (!name) {
    const names = listBrands(brandsRoot);
    process.stdout.write(
      names.length
        ? `Brands:\n${names.map((n) => "  · " + n).join("\n")}\n`
        : "No brands found (brands are optional — kino uses defaults).\n",
    );
    return;
  }
  process.stdout.write(brandText(ws.brandDir(name)));
}
