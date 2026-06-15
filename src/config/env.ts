import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export function loadEnv(root: string): void {
  const f = join(root, ".env");
  if (!existsSync(f)) return;
  for (const line of readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

export function requireKey(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}. Add it to .env or the environment.`);
  return v;
}
