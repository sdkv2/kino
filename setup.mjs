// kino setup — guided install: prerequisites (Node 20+, ffmpeg, ImageMagick), the `kino`
// command, and your API keys. Runs anywhere Node does, including Windows:
//
//   cd <your-project> && node /path/to/kino/setup.mjs      # .env lands in the current dir
//   node /path/to/kino/setup.mjs ~/path/to/project         # ...or a dir you pass
//
// (On macOS/Linux `bash setup.sh` still works — it's a shim that execs this file.)
//
// Non-interactive: supply keys via the environment (ELEVENLABS_API_KEY=... node setup.mjs) —
// any key already set skips its prompt. Values already in an existing .env are kept unless you
// type a replacement. Nothing is echoed back; the .env is chmod 600 and git-ignored.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, copyFileSync, appendFileSync, chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createInterface } from "node:readline";

const KINO_DIR = dirname(fileURLToPath(import.meta.url));
const WIN = process.platform === "win32";
const TTY = Boolean(process.stdin.isTTY && process.stdout.isTTY);

// ── style ────────────────────────────────────────────────────────────────────
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const [DIM, BOLD, ACC, GRN, YLW, RST] = color
  ? ["\x1b[2m", "\x1b[1m", "\x1b[38;5;166m", "\x1b[32m", "\x1b[33m", "\x1b[0m"]
  : ["", "", "", "", "", ""];
const ok = (s) => console.log(`  ${GRN}✓${RST} ${s}`);
const warn = (s) => console.log(`  ${YLW}!${RST} ${s}`);
const note = (s) => console.log(`  ${DIM}${s}${RST}`);
const step = (s) => console.log(`\n${BOLD}▸ ${s}${RST}`);
const fail = (s) => {
  console.error(`  ${ACC}✗ ${s}${RST}`);
  process.exit(1);
};

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", shell: WIN, ...opts });
}
const hasCmd = (cmd, args = ["-version"]) => run(cmd, args).status === 0;

// yes/no prompt, default yes; non-interactive runs answer yes only when FORCE=1
async function ask(q) {
  if (!TTY) return process.env.FORCE === "1";
  const a = await question(`  ${q} [Y/n] `);
  return !/^(n|no)$/i.test(a.trim());
}

// readline prompt; hidden=true suppresses the echo of typed characters
function question(prompt, { hidden = false } = {}) {
  return new Promise((res) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => { if (s.includes(prompt)) rl.output.write(prompt); };
    rl.question(prompt, (a) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      res(a);
    });
  });
}

// .env parser — same KEY=value shape src/config/env.ts reads (comments/garbage skipped)
export function parseEnv(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

async function main() {
  const PROJECT_DIR = resolve(process.argv[2] ?? process.cwd());

  console.log(`\n  ${ACC}+--${RST}                                ${ACC}--+${RST}\n`);
  console.log(String.raw`        _    _
       | | _(_)_ __   ___
       | |/ / | '_ \ / _ \
       |   <| | | | | (_) |
       |_|\_\_|_| |_|\___/`);
  console.log(`\n       ${DIM}agent-driven video production${RST}`);
  console.log(`\n  ${ACC}+--${RST}                                ${ACC}--+${RST}`);

  // ── prerequisites ──────────────────────────────────────────────────────────
  step("Prerequisites");

  const nodeMajor = Number(process.version.slice(1).split(".")[0]);
  if (nodeMajor < 20) fail(`Node ${process.version} is too old — kino needs Node 20+.`);
  ok(`node ${process.version}`);

  const missing = [];
  if (hasCmd("ffmpeg") && hasCmd("ffprobe")) ok("ffmpeg + ffprobe");
  else {
    warn("ffmpeg/ffprobe missing — required to render video");
    missing.push("ffmpeg");
  }
  if (hasCmd("magick") || hasCmd("montage")) ok("ImageMagick");
  else {
    warn("ImageMagick missing — optional, used for storyboard contact sheets");
    missing.push("imagemagick");
  }

  if (missing.length) {
    // ponytail: one package manager per platform (brew/apt/winget); anything else gets a manual note
    const winget = { ffmpeg: "Gyan.FFmpeg", imagemagick: "ImageMagick.ImageMagick" };
    if (!WIN && hasCmd("brew", ["--version"])) {
      if (await ask(`Install ${missing.join(" ")} with Homebrew?`)) {
        run("brew", ["install", ...missing], { stdio: "inherit" });
        ok(`installed: ${missing.join(" ")}`);
      } else note(`skipped — install later with: brew install ${missing.join(" ")}`);
    } else if (!WIN && hasCmd("apt-get", ["--version"])) {
      if (await ask(`Install ${missing.join(" ")} with apt-get (needs sudo)?`)) {
        run("sudo", ["apt-get", "update"], { stdio: "inherit" });
        run("sudo", ["apt-get", "install", "-y", ...missing], { stdio: "inherit" });
        ok(`installed: ${missing.join(" ")}`);
      } else note(`skipped — install later with: sudo apt-get install ${missing.join(" ")}`);
    } else if (WIN && hasCmd("winget", ["--version"])) {
      const ids = missing.map((m) => winget[m]);
      if (await ask(`Install ${missing.join(" ")} with winget?`)) {
        for (const id of ids) run("winget", ["install", "-e", "--id", id], { stdio: "inherit" });
        ok(`installed: ${missing.join(" ")} (open a new terminal if not on PATH yet)`);
      } else note(`skipped — install later with: winget install -e --id ${ids.join(" / ")}`);
    } else {
      warn(`no brew/apt-get/winget found — install manually: ${missing.join(" ")}`);
    }
  }

  // ── the kino command ───────────────────────────────────────────────────────
  step("Installing the kino command");
  note(`from ${KINO_DIR} (npm install → build → link) — may take a few minutes`);
  for (const args of [["install", "--no-fund", "--no-audit"], ["run", "build"], ["link"]]) {
    let r = run("npm", args, { cwd: KINO_DIR, stdio: ["ignore", "ignore", "pipe"] });
    // re-runs hit EEXIST on the already-linked bin — overwrite, that's the installer's job
    if (r.status !== 0 && args[0] === "link") r = run("npm", ["link", "--force"], { cwd: KINO_DIR, stdio: ["ignore", "ignore", "pipe"] });
    if (r.status !== 0) {
      if (r.stderr) process.stderr.write(r.stderr);
      fail(`npm ${args.join(" ")} failed in ${KINO_DIR}`);
    }
  }
  const v = run("kino", ["--version"]);
  if (v.status !== 0) fail("'kino' is not on your PATH — check that npm's global bin dir is on PATH.");
  ok(`kino ${v.stdout.trim()}`);

  // ── API keys ───────────────────────────────────────────────────────────────
  step("API keys");
  const ENV_FILE = resolve(PROJECT_DIR, ".env");
  const existing = existsSync(ENV_FILE) ? parseEnv(readFileSync(ENV_FILE, "utf8")) : {};
  note(`written to ${ENV_FILE} (chmod 600, git-ignored) — press Enter to skip/keep a key`);
  if (existsSync(ENV_FILE)) {
    copyFileSync(ENV_FILE, `${ENV_FILE}.bak`);
    note("existing .env backed up → .env.bak");
  }

  const lines = ["# kino API keys — DO NOT COMMIT"];
  const setKeys = [];
  const skipped = [];
  async function addKey(name, req, desc, url) {
    console.log(`\n  ${BOLD}${name}${RST} ${DIM}(${req})${RST} — ${desc}`);
    note(`get one: ${url}`);
    let val = process.env[name] ?? "";
    if (val) note("taken from the environment");
    else if (TTY) {
      const kept = existing[name];
      const prompt = kept ? `  > ${DIM}(Enter keeps existing)${RST} ` : "  > ";
      val = (await question(prompt, { hidden: true })).trim() || kept || "";
      if (!val.length) val = "";
      else if (val === kept) note("kept from existing .env");
    } else val = existing[name] ?? "";
    if (val) {
      lines.push(`${name}=${val}`);
      ok("set");
      setKeys.push(name);
    } else {
      note("skipped");
      skipped.push(name);
    }
  }

  await addKey("ELEVENLABS_API_KEY", "required", "voiceover (every real build)", "https://elevenlabs.io → Profile → API keys");
  await addKey("PEXELS_API_KEY", "optional", "stock b-roll via 'kino pexels'", "https://www.pexels.com/api");
  await addKey("HEYGEN_API_KEY", "optional", "HeyGen avatars (provider: heygen)", "https://app.heygen.com → Settings → API");
  await addKey("HEDRA_API_KEY", "optional", "Hedra avatars (provider: hedra)", "https://www.hedra.com/api-profile");
  await addKey("REPLICATE_API_TOKEN", "optional", "open-source lip-sync (provider: replicate)", "https://replicate.com/account/api-tokens");

  writeFileSync(ENV_FILE, lines.join("\n") + "\n");
  chmodSync(ENV_FILE, 0o600);

  // make sure the secrets never get committed
  const gitignore = resolve(PROJECT_DIR, ".gitignore");
  const gi = existsSync(gitignore) ? readFileSync(gitignore, "utf8") : "";
  if (!gi.split("\n").includes(".env")) appendFileSync(gitignore, (gi && !gi.endsWith("\n") ? "\n" : "") + ".env\n");

  // ── summary ────────────────────────────────────────────────────────────────
  step("Done");
  if (setKeys.length) ok(`keys set: ${setKeys.join(" ")}`);
  if (skipped.length) note(`skipped: ${skipped.join(" ")} (re-run setup or edit .env to add them)`);
  console.log("\n  Next:");
  console.log(`    cd ${PROJECT_DIR}`);
  console.log(`    kino doctor                        ${DIM}# verify the environment${RST}`);
  console.log(`    kino init <brand>                  ${DIM}# scaffold a brand + first project${RST}`);
  console.log(`    kino build specs/<spec>.json --mock  ${DIM}# free structural preview${RST}`);
  console.log("");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
