// Deterministic content hashing for cache keys. stable() serializes objects with sorted keys so
// that key order never changes the hash; contentHash() returns the first 16 hex chars of the
// SHA-256. Used everywhere a "did the inputs change?" cache decision is made.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/** SHA-256 (first 16 hex) of a file's bytes — cache keys for user-supplied media (voFile). */
export function fileHash(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 16);
}
function stable(v: unknown): string {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return "{" + Object.keys(v as object).sort().map((k) => `${k}:${stable((v as Record<string, unknown>)[k])}`).join(",") + "}";
  }
  return JSON.stringify(v);
}
export function contentHash(input: unknown): string {
  return createHash("sha256").update(stable(input)).digest("hex").slice(0, 16);
}
