import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// src/version.ts and dist/version.js are both one level under the package root (same trick as skills.ts).
const packageJsonPath = resolve(here, "../package.json");

export const KINO_VERSION: string = JSON.parse(readFileSync(packageJsonPath, "utf8")).version;
