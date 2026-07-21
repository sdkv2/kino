import { execa } from "execa";
import { resolveWorkspace } from "../config/project.js";
import { loadEnv } from "../config/env.js";
import { DEFAULT_SKILL_AGENTS, listBundledSkills, missingSkillAgents } from "../config/skills.js";
import { FFMPEG_PATH, FFPROBE_PATH } from "../media/binPaths.js";
import { listMusicIds, listSfxIds } from "../media/sfx.js";
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
  loadEnv(resolveWorkspace().workspaceRoot);
  const checks: Array<[string, boolean]> = [
    ["node", true],
    ["ffmpeg", await has(FFMPEG_PATH, ["-version"])],
    ["ffprobe", await has(FFPROBE_PATH, ["-version"])],
    ["heygen CLI (provider: heygen)", await has("heygen", ["--version"])],
    ["ELEVENLABS_API_KEY", !!process.env.ELEVENLABS_API_KEY],
    ["HEYGEN_API_KEY (provider: heygen)", !!process.env.HEYGEN_API_KEY],
    ["HEDRA_API_KEY (provider: hedra)", !!process.env.HEDRA_API_KEY],
    ["REPLICATE_API_TOKEN (provider: replicate)", !!process.env.REPLICATE_API_TOKEN],
    ["PEXELS_API_KEY (kino pexels — stock b-roll)", !!process.env.PEXELS_API_KEY],
    ["FREESOUND_API_KEY (kino music search — optional)", !!process.env.FREESOUND_API_KEY],
  ];
  for (const [n, ok] of checks) ok ? log.ok(n) : log.warn(`${n} missing`);

  const sfx = listSfxIds();
  const music = listMusicIds();
  if (sfx.length) log.ok(`assets-lib/sfx (${sfx.length}: ${sfx.join(", ")})`);
  else log.warn("assets-lib/sfx empty — SFX bare ids won't resolve (see assets-lib/sfx/README.md)");
  if (music.length) log.ok(`assets-lib/music (${music.length}: ${music.join(", ")})`);
  else log.info("assets-lib/music empty (ships empty) — bare ids need beds dropped there; project paths & Freesound unaffected");

  const { workspaceRoot } = resolveWorkspace();
  const bundled = listBundledSkills();
  if (!bundled.length) log.warn("package skills/ empty — agent playbooks missing from this install");
  else {
    const gaps = bundled.flatMap((n) =>
      missingSkillAgents(workspaceRoot, n).map((a) => `${n}[${a}]`),
    );
    if (gaps.length) {
      log.warn(`agent skills missing: ${gaps.join(", ")} — run: kino skills --install`);
    } else {
      log.ok(
        `agent skills (${bundled.join(", ")} → ${DEFAULT_SKILL_AGENTS.join(", ")})`,
      );
    }
  }

  log.info("Faceless (provider: none) needs only ELEVENLABS_API_KEY — no avatar credits (ffmpeg falls back to a bundled binary if not on PATH).");
  log.info("HeyGen lip-sync needs Avatar-IV photo looks (kino avatars); hedra/replicate need a portrait image (brand.avatarImage).");
  log.info("Music/SFX: kino music · bare ids in the spec · kino audio-markers to place sfx[].at");
}
