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
  loadEnv(resolveProject().workspaceRoot);
  const checks: Array<[string, boolean]> = [
    ["node", true],
    ["ffmpeg", await has("ffmpeg", ["-version"])],
    ["ffprobe", await has("ffprobe", ["-version"])],
    ["heygen CLI (provider: heygen)", await has("heygen", ["--version"])],
    ["ELEVENLABS_API_KEY", !!process.env.ELEVENLABS_API_KEY],
    ["HEYGEN_API_KEY (provider: heygen)", !!process.env.HEYGEN_API_KEY],
    ["HEDRA_API_KEY (provider: hedra)", !!process.env.HEDRA_API_KEY],
    ["REPLICATE_API_TOKEN (provider: replicate)", !!process.env.REPLICATE_API_TOKEN],
  ];
  for (const [n, ok] of checks) ok ? log.ok(n) : log.warn(`${n} missing`);
  log.info("Faceless (provider: none) needs only ffmpeg + ELEVENLABS_API_KEY — no avatar credits.");
  log.info("HeyGen lip-sync needs Avatar-IV photo looks (kino avatars); hedra/replicate need a portrait image (brand.avatarImage).");
}
