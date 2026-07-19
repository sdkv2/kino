import { resolveWorkspace } from "../config/project.js";
import {
  PACKAGE_SKILLS_DIR,
  SKILL_AGENT_DIRS,
  installAllSkills,
  listBundledSkills,
  missingSkillAgents,
  parseSkillAgents,
} from "../config/skills.js";
import { log } from "../log.js";

export async function skills(opts: { install?: boolean; agents?: string } = {}): Promise<void> {
  const names = listBundledSkills();
  if (!names.length) {
    log.warn(`No bundled skills in ${PACKAGE_SKILLS_DIR}`);
    return;
  }

  const agents = parseSkillAgents(opts.agents);

  if (opts.install) {
    const { workspaceRoot } = resolveWorkspace();
    const results = installAllSkills(workspaceRoot, { agents });
    for (const r of results) {
      const label = `${r.name} [${r.agent}]`;
      if (r.status === "missing-source") log.warn(`${label}: missing source`);
      else if (r.status === "unchanged") log.ok(`${label} (already → ${r.dest})`);
      else log.ok(`${label} ${r.status} → ${r.dest}`);
    }
    log.info(
      `Canonical source: skills/<name>/ in the kino package. ` +
        `Agent dirs: ${agents.map((a) => SKILL_AGENT_DIRS[a]).join(", ")}`,
    );
    return;
  }

  const { workspaceRoot } = resolveWorkspace();
  process.stdout.write(`Bundled skills (${PACKAGE_SKILLS_DIR}):\n`);
  for (const name of names) {
    const missing = missingSkillAgents(workspaceRoot, name, agents);
    const detail =
      missing.length === 0
        ? `✓ ${agents.join(",")}`
        : `✗ missing: ${missing.join(",")} — run: kino skills --install`;
    process.stdout.write(`  · ${name}  ${detail}\n`);
  }
  process.stdout.write(`\nTargets (${agents.join(", ")}):\n`);
  for (const a of agents) {
    process.stdout.write(`  · ${a.padEnd(8)} ${SKILL_AGENT_DIRS[a]}\n`);
  }
  process.stdout.write(`\nInstall / refresh: kino skills --install [--agents all|cursor,claude,…]\n`);
}
