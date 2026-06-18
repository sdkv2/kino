import { describe, it, expect } from "vitest";
import { resolveProject, resolveWorkspace, findUp } from "../src/config/project.js";
import { ProjectConfigSchema } from "../src/config/projectConfig.js";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("findUp", () => {
  it("returns the nearest ancestor that contains the marker", () => {
    const fs = new Set(["/a/brands"]);
    expect(findUp("/a/b/c", "brands", (p) => fs.has(p))).toBe("/a");
  });
  it("returns null when the marker is never found", () => {
    expect(findUp("/a/b/c", "brands", () => false)).toBeNull();
  });
});

function makeWorkspace() {
  const ws = mkdtempSync(join(tmpdir(), "kino-ws-"));
  mkdirSync(join(ws, "brands", "evidentcv"), { recursive: true });
  mkdirSync(join(ws, "projects", "launch", "specs"), { recursive: true });
  writeFileSync(join(ws, "projects", "launch", "project.json"), JSON.stringify({ brand: "evidentcv" }));
  return ws;
}

describe("resolveWorkspace", () => {
  it("resolves the shared workspace root, cache, and brand dir", () => {
    const ws = mkdtempSync(join(tmpdir(), "kino-ws-only-"));
    mkdirSync(join(ws, "brands", "evidentcv"), { recursive: true });
    const w = resolveWorkspace(ws);
    expect(w.workspaceRoot).toBe(ws);
    expect(w.cache).toBe(join(ws, ".kino-cache"));
    expect(w.brandDir("evidentcv")).toBe(join(ws, "brands", "evidentcv"));
  });
});

describe("resolveProject", () => {
  it("scopes assets/out to the project containing the spec; brands stay at the workspace", () => {
    const ws = makeWorkspace();
    const p = resolveProject({ specPath: join(ws, "projects", "launch", "specs", "hook.json"), cwd: ws });
    expect(p.projectRoot).toBe(join(ws, "projects", "launch"));
    expect(p.assetPath("a.png")).toBe(join(ws, "projects", "launch", "assets", "a.png"));
    expect(p.outDir("t")).toBe(join(ws, "projects", "launch", "out", "t"));
    expect(p.brandDir("evidentcv")).toBe(join(ws, "brands", "evidentcv"));
    expect(p.projectConfigPath).toBe(join(ws, "projects", "launch", "project.json"));
  });
  it("resolves a project by name under projects/", () => {
    const ws = makeWorkspace();
    const p = resolveProject({ project: "launch", cwd: ws });
    expect(p.projectRoot).toBe(join(ws, "projects", "launch"));
  });
  it("throws a clear error when the spec is not inside a project", () => {
    const ws = mkdtempSync(join(tmpdir(), "kino-noproj-"));
    mkdirSync(join(ws, "brands"), { recursive: true });
    writeFileSync(join(ws, "hook.json"), "{}");
    expect(() => resolveProject({ specPath: join(ws, "hook.json"), cwd: ws })).toThrow(/flat layout|No project found/i);
  });
  it("throws when a named project has no project.json", () => {
    const ws = makeWorkspace();
    expect(() => resolveProject({ project: "ghost", cwd: ws })).toThrow(/Project 'ghost' not found/i);
  });
  it("allows nested asset paths but rejects ones that escape the project assets dir (path traversal)", () => {
    const ws = makeWorkspace();
    const p = resolveProject({ project: "launch", cwd: ws });
    expect(p.assetPath("screens/x.png")).toBe(join(ws, "projects", "launch", "assets", "screens", "x.png"));
    expect(() => p.assetPath("../../../../etc/passwd")).toThrow(/escape/i);
    expect(() => p.assetPath("motion/../../../secret.js")).toThrow(/escape/i);
  });
});

describe("ProjectConfigSchema", () => {
  it("requires a brand and accepts optional default overrides", () => {
    expect(ProjectConfigSchema.parse({ brand: "evidentcv", background: "mesh" })).toMatchObject({ brand: "evidentcv", background: "mesh" });
    expect(ProjectConfigSchema.safeParse({}).success).toBe(false);
  });
});
