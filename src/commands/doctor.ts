import { execa } from "execa";
import { resolveProject } from "../config/project.js";
import { loadEnv } from "../config/env.js";
import { log } from "../log.js";

async function has(cmd: string, args: string[]): Promise<boolean> {
  try {
    await execa(cmd, args);
    return true;
  } catch {
    return false;
  }
}

export async function doctor(): Promise<void> {
  loadEnv(resolveProject().root);
  const checks: Array<[string, boolean]> = [
    ["node", true],
    ["ffmpeg", await has("ffmpeg", ["-version"])],
    ["ffprobe", await has("ffprobe", ["-version"])],
    ["heygen CLI", await has("heygen", ["--version"])],
    ["ELEVENLABS_API_KEY", !!process.env.ELEVENLABS_API_KEY],
    ["HEYGEN_API_KEY", !!process.env.HEYGEN_API_KEY],
  ];
  for (const [n, ok] of checks) ok ? log.ok(n) : log.warn(`${n} missing`);
  log.info("Reminder: HeyGen audio lip-sync requires Avatar-IV photo-avatar looks (kino avatars).");
}
