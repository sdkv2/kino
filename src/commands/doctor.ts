import { execa } from "execa";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveWorkspace } from "../config/project.js";
import { loadEnv } from "../config/env.js";
import { DEFAULT_SKILL_AGENTS, listBundledSkills, missingSkillAgents } from "../config/skills.js";
import { FFMPEG_PATH, FFPROBE_PATH } from "../media/binPaths.js";
import { listMusicIds, listSfxIds } from "../media/sfx.js";
import { launchBrowser, resolveExecutable } from "../render/native/browser.js";
import { resolveWhisper } from "../vo/whisper.js";
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
  const nodeMajor = Number(process.version.slice(1).split(".")[0]);
  // kino segment (coreml backend) readiness — Mac-only author-time mask engine.
  const samModels = process.env.KINO_SAM_MODEL ?? join(homedir(), ".kino", "sam", "models");
  const samModelsOk = existsSync(join(samModels, "SAM3.1_ImageEncoder_FP16.mlpackage"));
  const samPython = process.env.KINO_SAM_PYTHON ?? join(homedir(), ".kino", "sam", "venv", "bin", "python");
  const checks: Array<[string, boolean]> = [
    [`node ${process.version} (need 20+)`, nodeMajor >= 20],
    ["ffmpeg", await has(FFMPEG_PATH, ["-version"])],
    ["ffprobe", await has(FFPROBE_PATH, ["-version"])],
    [
      "ImageMagick (storyboard/frames contact sheets)",
      (await has("montage", ["-version"])) || (await has("magick", ["-version"])),
    ],
    ["heygen CLI (provider: heygen)", await has("heygen", ["--version"])],
    ["whisper-cli (voFile STT without ElevenLabs — optional)", resolveWhisper() != null],
    ["macOS/Apple Silicon (kino segment coreml backend)", process.platform === "darwin"],
    ["SAM3.1 CoreML models (kino segment — downloads on first run)", samModelsOk],
    ["SAM Python venv (KINO_SAM_PYTHON or ~/.kino/sam/venv)", existsSync(samPython)],
    ["ELEVENLABS_API_KEY", !!process.env.ELEVENLABS_API_KEY],
    ["HEYGEN_API_KEY (provider: heygen)", !!process.env.HEYGEN_API_KEY],
    ["HEDRA_API_KEY (provider: hedra)", !!process.env.HEDRA_API_KEY],
    ["REPLICATE_API_TOKEN (provider: replicate)", !!process.env.REPLICATE_API_TOKEN],
    ["PEXELS_API_KEY (kino pexels — stock b-roll)", !!process.env.PEXELS_API_KEY],
    ["FREESOUND_API_KEY (kino music search — optional)", !!process.env.FREESOUND_API_KEY],
  ];
  for (const [n, ok] of checks) ok ? log.ok(n) : log.warn(`${n} missing`);

  // Launch-check headless Chrome: a resolvable-but-broken binary (e.g. puppeteer's x86-64
  // download on linux-arm64) otherwise only surfaces at the first real render.
  try {
    const chrome = await resolveExecutable();
    const browser = await launchBrowser();
    await browser.close();
    log.ok(`headless Chrome (${chrome ?? "puppeteer bundled"})`);
  } catch (e) {
    const msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
    log.warn(`headless Chrome failed to launch — renders will fail. Point KINO_CHROME at a working Chrome/Chromium. (${msg})`);
  }

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
