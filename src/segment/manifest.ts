import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface MaskObject {
  id: number;
  label: string;
  channel: "r" | "g" | "b" | "a" | "gray";
}

export interface MaskManifest {
  kind: "image" | "video";
  source: string;
  prompt: string;
  width: number;
  height: number;
  fps?: number;
  frames?: number;
  objects: MaskObject[];
  backend: string;
  tracked: boolean;
}

const FILE = "manifest.json";

export function writeManifest(dir: string, m: MaskManifest): void {
  writeFileSync(join(dir, FILE), JSON.stringify(m, null, 2));
}

export function readManifest(dir: string): MaskManifest {
  const raw = JSON.parse(readFileSync(join(dir, FILE), "utf8")) as MaskManifest;
  if (!raw.kind || !Array.isArray(raw.objects)) throw new Error(`invalid mask manifest in ${dir}`);
  return raw;
}
