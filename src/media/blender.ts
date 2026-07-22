// Blender probe + timeline render spawn for 3D scene beats (Eevee drafts / Cycles finals).
// Probe order: KINO_BLENDER > PATH `blender` > /Applications/Blender.app/... (darwin). Min 4.2.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import type { Timeline } from "../render/scene/runScene.js";

const here = dirname(fileURLToPath(import.meta.url));
/** Fixed translator — ships with the package; NOT compiled. Resolve from package root (src or dist). */
export const KINO_RENDER_PY = resolve(here, "../../scripts/kino_render.py");

const MAC_APP = "/Applications/Blender.app/Contents/MacOS/Blender";
const MIN_MAJOR = 4;
const MIN_MINOR = 2;

function onPath(cmd: string): boolean {
  try {
    execSync(process.platform === "win32" ? `where ${cmd}` : `command -v ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Parse `Blender 4.5.1` / `Blender 5.2.0 LTS` → { major, minor, label } or null. */
function parseVersion(firstLine: string): { major: number; minor: number; label: string } | null {
  const m = firstLine.match(/Blender\s+(\d+)\.(\d+)/i);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), label: `${m[1]}.${m[2]}` };
}

function versionOf(bin: string): { major: number; minor: number; label: string } | null {
  try {
    const out = execSync(`"${bin}" --version`, { encoding: "utf8", timeout: 15_000 });
    const line = (out.split("\n")[0] ?? "").trim();
    return parseVersion(line);
  } catch {
    return null;
  }
}

function isNewEnough(v: { major: number; minor: number }): boolean {
  return v.major > MIN_MAJOR || (v.major === MIN_MAJOR && v.minor >= MIN_MINOR);
}

/** Resolve a usable Blender ≥ 4.2, or null (too-old / missing → treat as absent). */
export function resolveBlender(): { bin: string; version: string } | null {
  const candidates: string[] = [];
  if (process.env.KINO_BLENDER) candidates.push(process.env.KINO_BLENDER);
  if (onPath("blender")) candidates.push("blender");
  if (process.platform === "darwin" && existsSync(MAC_APP)) candidates.push(MAC_APP);

  for (const bin of candidates) {
    const v = versionOf(bin);
    if (!v || !isNewEnough(v)) continue;
    return { bin, version: v.label };
  }
  return null;
}

/** Write timeline.json and spawn Blender to render f00001.png… into outDir. */
export async function renderTimeline(opts: {
  timeline: Timeline;
  outDir: string;
  publicDir: string;
  blenderBin: string;
}): Promise<void> {
  const { timeline, outDir, publicDir, blenderBin } = opts;
  if (!existsSync(KINO_RENDER_PY)) {
    throw new Error(`kino_render.py missing at ${KINO_RENDER_PY}`);
  }
  mkdirSync(outDir, { recursive: true });
  const timelinePath = join(outDir, "timeline.json");
  writeFileSync(timelinePath, JSON.stringify(timeline));

  const result = await execa(
    blenderBin,
    ["-b", "--factory-startup", "-noaudio", "-P", KINO_RENDER_PY, "--", timelinePath, outDir, publicDir],
    { reject: false, all: true },
  );
  if (result.exitCode !== 0) {
    const tail = (result.all ?? result.stderr ?? result.stdout ?? "").trim().split("\n").slice(-40).join("\n");
    throw new Error(`Blender render failed (exit ${result.exitCode}):\n${tail}`);
  }
}
