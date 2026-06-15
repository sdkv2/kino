import { createHash } from "node:crypto";
function stable(v: unknown): string {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return "{" + Object.keys(v as object).sort().map((k) => `${k}:${stable((v as Record<string, unknown>)[k])}`).join(",") + "}";
  }
  return JSON.stringify(v);
}
export function contentHash(input: unknown): string {
  return createHash("sha256").update(stable(input)).digest("hex").slice(0, 16);
}
