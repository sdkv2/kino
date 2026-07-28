import { execa } from "execa";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describeStaleScratch, scanStaleScratch } from "../scratch.js";
import { resolveWorkspace } from "../config/project.js";
import { loadEnv } from "../config/env.js";
import { DEFAULT_SKILL_AGENTS, listBundledSkills, missingSkillAgents } from "../config/skills.js";
import { FFMPEG_PATH, FFPROBE_PATH } from "../media/binPaths.js";
import { listMusicIds, listSfxIds } from "../media/sfx.js";
import { describeElectronHost, electronBinaryPath } from "../render/native/renderer.js";
import { hasDisplay, nvidiaDrmModeset, type ModesetStatus } from "../render/native/sandbox.js";
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

/** Linux-only: does the electron render host have a real X/Wayland display to attach to?
 *  --ozone-platform=headless starts Electron but yields no WebGL2 on any ANGLE backend (measured
 *  on an RTX 3060 Ti — see sandbox.ts's hasDisplay), so a missing display isn't survivable, only
 *  detectable up front. Without this row it surfaces as an unexplained 60s awaitBoot timeout. */
export function describeDisplayCheck(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): { level: "ok" | "warn"; message: string } {
  if (hasDisplay(env, platform)) {
    return { level: "ok", message: "X/Wayland display present (electron render host can use hardware GL)" };
  }
  return {
    level: "warn",
    message:
      "no X/Wayland display — electron's hardware GL needs a real display; headless Ozone mode " +
      "boots but loses the GPU (NO_WEBGL2). Run under a virtual display, e.g.\n" +
      "  xvfb-run -a --server-args='-screen 0 1280x1024x24' kino build <spec>",
  };
}

/** Linux-only: is `nvidia-drm.modeset=1` set on this host? That is the gate on DRI3, which is the
 *  gate on Chromium creating a GBM device for zero-copy shared-texture capture — proven by
 *  elimination across Xvfb, headless Wayland, and a real Xorg+NVIDIA session (GL bound the real
 *  GPU and GBM still failed).
 *
 *  Two things this row must get right:
 *  - `enabled` is a prerequisite, not a feature check — kino has no Linux shared-texture capture
 *    implemented at all yet, so this must never read as "and zero-copy capture works now".
 *  - `disabled` is NOT a warning. Linux `auto` already resolves to `direct`, which is faster than
 *    the NVENC `readback` path today (69.9 vs 34.4 fps measured) — nothing is broken, so this is
 *    informational only.
 *
 *  Returns null when there's no NVIDIA driver at all (the sysfs file is absent): that is not a fact
 *  worth a row, and reporting it as "disabled" would misreport hardware that never had the option. */
export function describeModesetCheck(
  status: ModesetStatus = nvidiaDrmModeset(),
): { level: "ok" | "info"; message: string } | null {
  if (status === "unknown") return null;
  if (status === "enabled") {
    return {
      level: "ok",
      message:
        "nvidia-drm.modeset=1 (DRI3 available) — this is a prerequisite for zero-copy GPU capture on " +
        "Linux, which kino does not implement yet (today's Linux capture is `direct` or NVENC `readback`).",
    };
  }
  return {
    level: "info",
    message:
      "nvidia-drm.modeset is disabled (N) — zero-copy GPU capture is unavailable (Chromium needs DRI3, " +
      "which NVIDIA's X driver only exposes with modeset=1). This is informational, not a problem: kino " +
      "uses `direct` capture instead, which is faster today than the NVENC `readback` path (69.9 vs " +
      "34.4 fps measured). To enable modeset for future zero-copy support, this needs host root — " +
      "impossible from inside a container:\n" +
      "  echo 'options nvidia-drm modeset=1' | sudo tee /etc/modprobe.d/nvidia-drm.conf\n" +
      "  sudo update-initramfs -u && sudo reboot",
  };
}

// Package set a bare container image (e.g. nvidia/cuda) is missing, measured against
// `error while loading shared libraries: libnspr4.so`.
const ELECTRON_APT_PACKAGES = [
  "libnspr4",
  "libnss3",
  "libatk1.0-0",
  "libatk-bridge2.0-0",
  "libcups2",
  "libdrm2",
  "libxkbcommon0",
  "libxcomposite1",
  "libxdamage1",
  "libxfixes3",
  "libxrandr2",
  "libgbm1",
  "libasound2",
  "libpango-1.0-0",
  "libcairo2",
  "libgtk-3-0",
  "libxshmfence1",
];

/** Linux-only: does Electron's binary resolve all of its shared libraries? A container image with
 *  the electron package installed but missing Chromium's runtime deps (e.g. a bare `nvidia/cuda`
 *  base) fails at process startup with `error while loading shared libraries: libnspr4.so` — `ldd`
 *  reports the same gap as "not found" lines well before a render is attempted. */
export async function describeSharedLibsCheck(
  binPath: string,
  runLdd: (bin: string) => Promise<string> = async (bin) => (await execa("ldd", [bin])).stdout,
): Promise<{ level: "ok" | "warn"; message: string }> {
  let out: string;
  try {
    out = await runLdd(binPath);
  } catch (e) {
    // ldd missing from the image, or the binary isn't a dynamic executable — don't block doctor on
    // a check that itself couldn't run; the render will still surface a real error if libs are gone.
    const msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
    return { level: "ok", message: `electron shared libraries: ldd check skipped (${msg})` };
  }
  const missing = out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.includes("not found"));
  if (!missing.length) return { level: "ok", message: "electron shared libraries resolve (ldd)" };
  return {
    level: "warn",
    message:
      `electron is missing shared libraries — ${missing.join("; ")}. Install with:\n` +
      `  apt-get install -y ${ELECTRON_APT_PACKAGES.join(" ")}`,
  };
}

export async function doctor(): Promise<void> {
  loadEnv(resolveWorkspace().workspaceRoot);
  const nodeMajor = Number(process.version.slice(1).split(".")[0]);
  // kino segment (coreml backend) readiness — Mac-only author-time mask engine.
  const samModels = process.env.KINO_SAM_MODEL ?? join(homedir(), ".kino", "sam", "models");
  const samModelsOk = existsSync(join(samModels, "SAM3.1_ImageEncoder_FP16.mlpackage"));
  const samPython = process.env.KINO_SAM_PYTHON ?? join(homedir(), ".kino", "sam", "venv", "bin", "python");
  const samPythonOk = existsSync(samPython);
  const checks: Array<[string, boolean]> = [
    [`node ${process.version} (need 22+)`, nodeMajor >= 22],
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
    ["SAM Python venv (KINO_SAM_PYTHON or ~/.kino/sam/venv)", samPythonOk],
    // cuda backend (kino segment on Linux/Windows + NVIDIA): same venv, needs a CUDA torch + the
    // sam3 package (pip install -e sam3). Real video tracking. Needs an NVIDIA GPU at run time.
    ["SAM Python for cuda backend (needs NVIDIA GPU + torch-cuda + sam3 pkg — real video tracking)", samPythonOk],
    ["ELEVENLABS_API_KEY", !!process.env.ELEVENLABS_API_KEY],
    ["HEYGEN_API_KEY (provider: heygen)", !!process.env.HEYGEN_API_KEY],
    ["HEDRA_API_KEY (provider: hedra)", !!process.env.HEDRA_API_KEY],
    ["REPLICATE_API_TOKEN (provider: replicate)", !!process.env.REPLICATE_API_TOKEN],
    ["PEXELS_API_KEY (kino pexels — stock b-roll)", !!process.env.PEXELS_API_KEY],
    ["FREESOUND_API_KEY (kino music search — optional)", !!process.env.FREESOUND_API_KEY],
  ];
  for (const [n, ok] of checks) ok ? log.ok(n) : log.warn(`${n} missing`);

  // Electron renders everything — video, stills, storyboards, frames — so this row is fatal-shaped
  // rather than advisory: there is no second renderer to fall back to.
  const el = describeElectronHost();
  el.level === "ok" ? log.ok(el.message) : log.warn(el.message);

  // Two Linux-specific gates the electron path needs, neither visible from `el` above: a real
  // display for hardware GL, and Chromium's shared libraries actually resolving. Both are
  // measured on real hardware (see sandbox.ts) — a missing one otherwise surfaces mid-render as a
  // 60s boot timeout or a raw ldd-style crash.
  if (process.platform === "linux") {
    const display = describeDisplayCheck();
    display.level === "ok" ? log.ok(display.message) : log.warn(display.message);

    let bin: string | null = null;
    try {
      bin = electronBinaryPath();
    } catch {
      bin = null; // already reported by describeElectronHost above
    }
    if (bin) {
      const libs = await describeSharedLibsCheck(bin);
      libs.level === "ok" ? log.ok(libs.message) : log.warn(libs.message);
    }

    // Omitted entirely with no NVIDIA driver (describeModesetCheck returns null) — see its doc
    // comment for why "disabled" is informational rather than a warning.
    const modeset = describeModesetCheck();
    if (modeset) {
      modeset.level === "ok" ? log.ok(modeset.message) : log.info(modeset.message);
    }
  }

  // Abandoned render scratch. A slow leak here is invisible until a build dies with ENOSPC, so it
  // gets its own row rather than waiting for the disk to fill.
  const scratchRoot = tmpdir();
  const stale = describeStaleScratch(scanStaleScratch(scratchRoot), scratchRoot);
  stale.level === "ok" ? log.ok(stale.message) : log.warn(stale.message);

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
