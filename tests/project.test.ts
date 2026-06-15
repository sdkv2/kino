import { describe, it, expect } from "vitest";
import { resolveProject } from "../src/config/project.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("resolveProject", () => {
  it("derives standard subpaths from a project root", () => {
    const root = mkdtempSync(join(tmpdir(), "kino-"));
    const p = resolveProject(root);
    expect(p.root).toBe(root);
    expect(p.brands).toBe(join(root, "brands"));
    expect(p.assets).toBe(join(root, "assets"));
    expect(p.out).toBe(join(root, "out"));
    expect(p.cache).toBe(join(root, ".kino-cache"));
    expect(p.brandDir("evidentcv")).toBe(join(root, "brands", "evidentcv"));
  });
});
