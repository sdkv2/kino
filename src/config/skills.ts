// Bundled agent skills live in the package's skills/ directory (npm files + git source of truth).
// `kino skills --install` (also called from init) symlinks them into each agent’s project skill dir
// so Cursor / Claude Code / Codex / universal agents all see the same playbooks.
// Those agent dirs are gitignored — only skills/ ships in the repo.
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// src/config and dist/config are both two levels under the package root (same trick as sfx.ts).
export const PACKAGE_SKILLS_DIR = resolve(here, "../../skills");

/** Project-relative skill roots for popular agents (vercel-skills / Cursor / Claude / Codex). */
export const SKILL_AGENT_DIRS = {
  agents: ".agents/skills",
  cursor: ".cursor/skills",
  claude: ".claude/skills",
  codex: ".codex/skills",
} as const;

export type SkillAgent = keyof typeof SKILL_AGENT_DIRS;

export const DEFAULT_SKILL_AGENTS: SkillAgent[] = ["agents", "cursor", "claude", "codex"];

export function listBundledSkills(skillsDir: string = PACKAGE_SKILLS_DIR): string[] {
  if (!existsSync(skillsDir)) return [];
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(skillsDir, e.name, "SKILL.md")))
    .map((e) => e.name)
    .sort();
}

export function agentSkillsDir(workspaceRoot: string, agent: SkillAgent): string {
  return join(workspaceRoot, SKILL_AGENT_DIRS[agent]);
}

/** Parse `--agents cursor,claude` or `all` / `*`. Unknown names throw. */
export function parseSkillAgents(spec?: string): SkillAgent[] {
  if (!spec || spec === "all" || spec === "*") return [...DEFAULT_SKILL_AGENTS];
  const out: SkillAgent[] = [];
  for (const raw of spec.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)) {
    const key = raw === "claude-code" ? "claude" : raw;
    if (!(key in SKILL_AGENT_DIRS)) {
      throw new Error(
        `Unknown skill agent '${raw}'. Use: ${DEFAULT_SKILL_AGENTS.join(", ")} (or all)`,
      );
    }
    if (!out.includes(key as SkillAgent)) out.push(key as SkillAgent);
  }
  if (!out.length) throw new Error("No skill agents given.");
  return out;
}

export type SkillInstallResult = {
  name: string;
  agent: SkillAgent;
  dest: string;
  status: "linked" | "copied" | "unchanged" | "missing-source";
};

function isSymlinkTo(dest: string, targetAbs: string): boolean {
  try {
    if (!lstatSync(dest).isSymbolicLink()) return false;
    const resolved = resolve(dirname(dest), readlinkSync(dest));
    return resolved === targetAbs;
  } catch {
    return false;
  }
}

/** Install one skill into one agent’s project skill dir. Prefers a relative symlink. */
export function installSkill(
  workspaceRoot: string,
  name: string,
  opts: { skillsDir?: string; agent?: SkillAgent } = {},
): SkillInstallResult {
  const skillsDir = opts.skillsDir ?? PACKAGE_SKILLS_DIR;
  const agent = opts.agent ?? "agents";
  const source = join(skillsDir, name);
  const destDir = agentSkillsDir(workspaceRoot, agent);
  const dest = join(destDir, name);
  if (!existsSync(join(source, "SKILL.md"))) {
    return { name, agent, dest, status: "missing-source" };
  }
  mkdirSync(destDir, { recursive: true });
  const sourceAbs = resolve(source);
  if (isSymlinkTo(dest, sourceAbs)) {
    return { name, agent, dest, status: "unchanged" };
  }
  rmSync(dest, { recursive: true, force: true });
  const rel = relative(dirname(dest), sourceAbs);
  try {
    symlinkSync(rel, dest);
    return { name, agent, dest, status: "linked" };
  } catch {
    // Windows without symlink privilege, or FS that rejects links — copy instead.
    cpSync(sourceAbs, dest, { recursive: true });
    return { name, agent, dest, status: "copied" };
  }
}

/** Install every bundled skill into each requested agent dir (default: all popular agents). */
export function installAllSkills(
  workspaceRoot: string,
  opts: { skillsDir?: string; agents?: SkillAgent[] } = {},
): SkillInstallResult[] {
  const skillsDir = opts.skillsDir ?? PACKAGE_SKILLS_DIR;
  const agents = opts.agents ?? DEFAULT_SKILL_AGENTS;
  const results: SkillInstallResult[] = [];
  for (const name of listBundledSkills(skillsDir)) {
    for (const agent of agents) {
      results.push(installSkill(workspaceRoot, name, { skillsDir, agent }));
    }
  }
  return results;
}

/** True when workspace <agent>/.skills/<name>/SKILL.md resolves (default agent: agents). */
export function skillInstalled(
  workspaceRoot: string,
  name: string,
  agent: SkillAgent = "agents",
): boolean {
  return existsSync(join(agentSkillsDir(workspaceRoot, agent), name, "SKILL.md"));
}

/** Agents (from the default set) that are missing this skill. */
export function missingSkillAgents(
  workspaceRoot: string,
  name: string,
  agents: SkillAgent[] = DEFAULT_SKILL_AGENTS,
): SkillAgent[] {
  return agents.filter((a) => !skillInstalled(workspaceRoot, name, a));
}
