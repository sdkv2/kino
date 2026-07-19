import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readlinkSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  PACKAGE_SKILLS_DIR,
  SKILL_AGENT_DIRS,
  installAllSkills,
  installSkill,
  listBundledSkills,
  parseSkillAgents,
  skillInstalled,
} from "../src/config/skills.js";

describe("bundled skills package", () => {
  it("ships the production skills with SKILL.md", () => {
    const names = listBundledSkills();
    const expected = [
      "video-production",
      "ad-voice",
      "adversarial-critique",
      "importing-footage",
      "speech-synced-ui",
    ];
    expect(names).toEqual(expect.arrayContaining(expected));
    for (const n of expected) {
      expect(existsSync(join(PACKAGE_SKILLS_DIR, n, "SKILL.md"))).toBe(true);
    }
  });
});

describe("parseSkillAgents", () => {
  it("defaults to all popular agents", () => {
    expect(parseSkillAgents()).toEqual(["agents", "cursor", "claude", "codex"]);
    expect(parseSkillAgents("all")).toEqual(["agents", "cursor", "claude", "codex"]);
  });
  it("accepts a subset and claude-code alias", () => {
    expect(parseSkillAgents("cursor,claude-code")).toEqual(["cursor", "claude"]);
  });
  it("rejects unknown names", () => {
    expect(() => parseSkillAgents("windsurf")).toThrow(/Unknown skill agent/);
  });
});

describe("installAllSkills", () => {
  it("fans out into .agents / .cursor / .claude / .codex skill dirs", () => {
    const root = mkdtempSync(join(tmpdir(), "kino-skills-"));
    const fakePkg = join(root, "pkg-skills");
    for (const name of ["alpha", "beta"]) {
      mkdirSync(join(fakePkg, name), { recursive: true });
      writeFileSync(join(fakePkg, name, "SKILL.md"), `---\nname: ${name}\n---\n# ${name}\n`);
    }
    const ws = join(root, "workspace");
    mkdirSync(ws);

    const results = installAllSkills(ws, { skillsDir: fakePkg });
    expect(results).toHaveLength(2 * 4); // skills × agents
    expect(results.every((r) => r.status === "linked" || r.status === "copied")).toBe(true);

    for (const agent of ["agents", "cursor", "claude", "codex"] as const) {
      expect(skillInstalled(ws, "alpha", agent)).toBe(true);
      expect(existsSync(join(ws, SKILL_AGENT_DIRS[agent], "beta", "SKILL.md"))).toBe(true);
    }

    const again = installSkill(ws, "alpha", { skillsDir: fakePkg, agent: "cursor" });
    expect(again.status).toBe("unchanged");

    const dest = join(ws, ".cursor", "skills", "alpha");
    if (results.find((r) => r.name === "alpha" && r.agent === "cursor")?.status === "linked") {
      expect(readlinkSync(dest).startsWith("/")).toBe(false);
    }

    // Subset install
    const only = installAllSkills(ws, { skillsDir: fakePkg, agents: ["codex"] });
    expect(only.every((r) => r.agent === "codex")).toBe(true);

    rmSync(root, { recursive: true, force: true });
  });
});
