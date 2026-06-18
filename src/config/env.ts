// Environment & .env loading. loadEnv() reads the workspace-root .env (KEY=value lines, optional
// quotes) into process.env without overwriting anything already set; requireKey() fetches a named
// var or throws. Central place for "where do secrets come from": commands (build, voices,
// transcribe, doctor) call loadEnv() then requireKey()/read process.env for the keys they need
// (ELEVENLABS_API_KEY / HEYGEN_API_KEY / HEDRA_API_KEY / REPLICATE_API_TOKEN). This module is key-
// agnostic — it neither hardcodes those names nor reads flags like KINO_DEBUG (that lives in cli.ts).
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
