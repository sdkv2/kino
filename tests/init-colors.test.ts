import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, existsSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { init } from "../src/commands/init.js";
import { colors } from "../src/commands/colors.js";
import { SpecSchema } from "../src/spec/schema.js";
import { PALETTE_PRESETS, PALETTE_ROLES } from "../src/config/palettes.js";

/** Run `init` inside a throwaway workspace (it resolves the root from cwd). */
async function initIn(brand?: string): Promise<string> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "kino-init-")));
  const cwd = process.cwd();
  try {
    process.chdir(root);
    await init(brand);
  } finally {
    process.chdir(cwd);
  }
  return root;
}

describe("kino init", () => {
  it("scaffolds no brand when none is named, and the sample spec carries its own colours", async () => {
    const root = await initIn();
    expect(existsSync(join(root, "brands"))).toBe(false);
    expect(JSON.parse(readFileSync(join(root, "projects", "default", "project.json"), "utf8"))).toEqual({});
    const spec = SpecSchema.parse(JSON.parse(readFileSync(join(root, "projects", "default", "specs", "sample.json"), "utf8")));
    expect(spec.colors).toBe("midnight");
  });

  it("still scaffolds a brand when one is named, on role keys", async () => {
    const root = await initIn("acme");
    const md = readFileSync(join(root, "brands", "acme", "brand.md"), "utf8");
    expect(md).toMatch(/colors: \{ bg:/);
    expect(JSON.parse(readFileSync(join(root, "projects", "acme", "project.json"), "utf8"))).toEqual({ brand: "acme" });
  });
});

describe("kino colors", () => {
  afterEach(() => vi.restoreAllMocks());

  it("lists every preset with all five roles", async () => {
    let out = "";
    vi.spyOn(process.stdout, "write").mockImplementation((c: unknown) => ((out += String(c)), true));
    await colors();
    for (const [name, palette] of Object.entries(PALETTE_PRESETS)) {
      expect(out).toContain(name);
      for (const role of PALETTE_ROLES) expect(out).toContain(`${role}:${palette[role]}`);
    }
    expect(out).toContain('"colors"');
  });
});
