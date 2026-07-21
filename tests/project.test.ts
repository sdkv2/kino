import { describe, it, expect } from "vitest";
import { resolveProject, resolveWorkspace, findUp } from "../src/config/project.js";
import { ProjectConfigSchema } from "../src/config/projectConfig.js";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";

describe("findUp", () => {
  // findUp joins with the platform separator, so fixture paths must too or the win32 lookups miss.
  const P = (s: string) => s.split("/").join(sep);
  it("returns the nearest ancestor that contains the marker", () => {
    const fs = new Set([P("/a/brands")]);
    expect(findUp(P("/a/b/c"), "brands", (p) => fs.has(p))).toBe(P("/a"));
  });
  it("returns null when the marker is never found", () => {
    expect(findUp(P("/a/b/c"), "brands", () => false)).toBeNull();
  });
});

function makeWorkspace() {
  const ws = mkdtempSync(join(tmpdir(), "kino-ws-"));
  mkdirSync(join(ws, "brands", "acme"), { recursive: true });
  mkdirSync(join(ws, "projects", "launch", "specs"), { recursive: true });
  writeFileSync(join(ws, "projects", "launch", "project.json"), JSON.stringify({ brand: "acme" }));
  return ws;
}

describe("resolveWorkspace", () => {
  it("resolves the shared workspace root, cache, and brand dir", () => {
    const ws = mkdtempSync(join(tmpdir(), "kino-ws-only-"));
    mkdirSync(join(ws, "brands", "acme"), { recursive: true });
    const w = resolveWorkspace(ws);
    expect(w.workspaceRoot).toBe(ws);
    expect(w.cache).toBe(join(ws, ".kino-cache"));
    expect(w.brandDir("acme")).toBe(join(ws, "brands", "acme"));
  });
  it("throws when no brands/ exists (unless create: true)", () => {
    const empty = mkdtempSync(join(tmpdir(), "kino-no-brands-"));
    expect(() => resolveWorkspace(empty)).toThrow(/No brands\//);
    expect(resolveWorkspace(empty, { create: true }).workspaceRoot).toBe(empty);
  });
});

describe("resolveProject", () => {
  it("scopes assets/out to the project containing the spec; brands stay at the workspace", () => {
    const ws = makeWorkspace();
    const p = resolveProject({ specPath: join(ws, "projects", "launch", "specs", "hook.json"), cwd: ws });
    expect(p.projectRoot).toBe(join(ws, "projects", "launch"));
    expect(p.assetPath("a.png")).toBe(join(ws, "projects", "launch", "assets", "a.png"));
    expect(p.outDir("t")).toBe(join(ws, "projects", "launch", "out", "t"));
    expect(p.brandDir("acme")).toBe(join(ws, "brands", "acme"));
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
  it("prefers a nested demos workspace brands/ over a parent brands/ when resolving via spec path", () => {
    const root = mkdtempSync(join(tmpdir(), "kino-nested-"));
    mkdirSync(join(root, "brands", "parentbrand"), { recursive: true });
    const demos = join(root, "demos");
    mkdirSync(join(demos, "brands", "hold"), { recursive: true });
    mkdirSync(join(demos, "projects", "hold", "specs"), { recursive: true });
    writeFileSync(join(demos, "projects", "hold", "project.json"), JSON.stringify({ brand: "hold" }));
    const p = resolveProject({
      specPath: join(demos, "projects", "hold", "specs", "trailer.json"),
      cwd: root, // parent also has brands/ — must not latch onto it
    });
    expect(p.workspaceRoot).toBe(demos);
    expect(p.brandDir("hold")).toBe(join(demos, "brands", "hold"));
    expect(p.projectRoot).toBe(join(demos, "projects", "hold"));
  });
});

describe("ProjectConfigSchema", () => {
  it("accepts an optional brand and optional default overrides", () => {
    expect(ProjectConfigSchema.parse({ brand: "acme", background: "mesh" })).toMatchObject({ brand: "acme", background: "mesh" });
    expect(ProjectConfigSchema.parse({}).brand).toBeUndefined();
    expect(ProjectConfigSchema.safeParse({ brand: 7 }).success).toBe(false);
  });
});
