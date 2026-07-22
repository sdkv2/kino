// kino update — self-update matched to how kino was installed:
//   git clone + npm link → git pull --ff-only, npm install, npm run build
//   npm i -g            → npm install -g @sdkv2/kino@latest
//   npx                 → nothing to do (npx resolves fresh each first run)
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { log } from "../log.js";

export type InstallKind = "git" | "global" | "npx";

/** How this kino was installed, from its package root. `exists` injectable for tests. */
export function detectInstallKind(packageRoot: string, exists: (p: string) => boolean = existsSync): InstallKind {
  if (exists(join(packageRoot, ".git"))) return "git";
  if (packageRoot.split(sep).includes("_npx")) return "npx";
  return "global";
}

const version = (root: string): string => {
  try {
    return JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version ?? "?";
  } catch {
    return "?";
  }
};

export async function update(): Promise<void> {
  // dist/commands/update.js → package root two levels up.
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const kind = detectInstallKind(root);
  const before = version(root);

  if (kind === "npx") {
    log.info(`running via npx (${before}) — npx fetches the latest on each fresh run; nothing to update`);
    return;
  }
  if (kind === "global") {
    log.step(`npm install -g @sdkv2/kino@latest (current ${before})`);
    await execa("npm", ["install", "-g", "@sdkv2/kino@latest"], { stdio: "inherit" });
    log.ok("updated — run `kino --version` to confirm");
    return;
  }

  log.step(`git pull (repo install at ${root}, current ${before})`);
  const pull = await execa("git", ["pull", "--ff-only"], { cwd: root, reject: false });
  if (pull.exitCode !== 0) {
    throw new Error(`git pull failed — ${pull.stderr.split("\n")[0] || "resolve manually in " + root}`);
  }
  if (/Already up to date/i.test(pull.stdout)) {
    log.ok(`already up to date (${before})`);
    return;
  }
  log.step("npm install");
  await execa("npm", ["install", "--no-audit", "--no-fund"], { cwd: root, stdio: "inherit" });
  log.step("npm run build");
  await execa("npm", ["run", "build"], { cwd: root, stdio: "inherit" });
  log.ok(`updated ${before} → ${version(root)}`);
}
