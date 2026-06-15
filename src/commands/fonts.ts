import { existsSync } from "node:fs";
import { FONTS } from "../fonts/registry.js";
import { fontPath } from "../fonts/manager.js";

// List the curated fonts with descriptions + cache status. (Downloaded on demand at build time.)
export async function fonts(): Promise<void> {
  process.stdout.write("Fonts (● cached · ○ downloads on first use):\n\n");
  for (const f of FONTS) {
    const dot = existsSync(fontPath(f.name)) ? "●" : "○";
    process.stdout.write(`  ${dot} ${f.name.padEnd(18)} ${f.description}\n`);
  }
  process.stdout.write('\nUse a name as brand.font (e.g. "Anton") or brand.labelFont.\n');
}
