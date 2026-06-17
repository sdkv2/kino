import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadBrand, loadBrandDoc, DEFAULT_BRAND, parseBrandMd } from "../src/config/brand.js";
import { resolveVoice, validateSpec } from "../src/spec/validate.js";
import type { Spec } from "../src/spec/schema.js";
import { brandText, listBrands } from "../src/commands/brand.js";

function brandDirWith(md: string) {
  const root = mkdtempSync(join(tmpdir(), "kino-brand-"));
  const dir = join(root, "brands", "acme");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "brand.md"), md);
  return dir;
}

describe("parseBrandMd", () => {
  it("splits YAML frontmatter from the body", () => {
    const { frontmatter, body } = parseBrandMd("---\nname: acme\n---\n# Guide\n- be bold\n");
    expect(frontmatter).toEqual({ name: "acme" });
    expect(body.trim()).toBe("# Guide\n- be bold".trim());
  });
  it("treats a body-only file as all-body, empty frontmatter", () => {
    const { frontmatter, body } = parseBrandMd("# Just guidelines\n- tone: calm\n");
    expect(frontmatter).toEqual({});
    expect(body).toContain("Just guidelines");
  });
});

describe("loadBrand", () => {
  it("merges partial frontmatter over DEFAULT_BRAND", () => {
    const dir = brandDirWith('---\nname: acme\ncolors: { night: "#101010" }\nfont: Sora\ndefaultVoice: v123\n---\nguide\n');
    const b = loadBrand(dir);
    expect(b.name).toBe("acme");
    expect(b.colors.night).toBe("#101010"); // overridden
    expect(b.colors.mint).toBe(DEFAULT_BRAND.colors.mint); // defaulted
    expect(b.font).toBe("Sora");
    expect(b.defaultVoice).toBe("v123");
    expect(b.disclosure).toBe(""); // no default disclosure
    expect(b.captionStyle.fontSize).toBe(74); // defaulted
  });
  it("a frontmatter-less brand.md resolves to all defaults", () => {
    const dir = brandDirWith("# acme guidelines\n- calm, plain-spoken\n");
    const b = loadBrand(dir);
    expect(b.colors).toEqual(DEFAULT_BRAND.colors);
    expect(b.disclosure).toBe("");
  });
  it("throws a clear error when brand.md is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "kino-nobrand-"));
    expect(() => loadBrand(join(root, "brands", "ghost"))).toThrow(/brand\.md/);
  });
  it("rejects a malformed frontmatter type", () => {
    const dir = brandDirWith("---\ncaptionMode: sideways\n---\n");
    expect(() => loadBrand(dir)).toThrow();
  });
});

describe("loadBrandDoc", () => {
  it("returns the resolved brand + the guidelines body", () => {
    const dir = brandDirWith("---\nname: acme\n---\n# Guide\n- punchy\n");
    const { brand, body } = loadBrandDoc(dir);
    expect(brand.name).toBe("acme");
    expect(body).toContain("punchy");
  });
});

describe("resolveVoice (lazy)", () => {
  it("returns '' when no voice is set anywhere (no throw)", () => {
    expect(resolveVoice({} as Spec, DEFAULT_BRAND)).toBe("");
  });
  it("resolves spec.voice through aliases", () => {
    expect(resolveVoice({ voice: "will" } as Spec, { ...DEFAULT_BRAND, voiceAliases: { will: "v9" } })).toBe("v9");
  });
});

describe("validateSpec (no eager look requirement)", () => {
  it("does not throw for a faceless spec with no voice/look", () => {
    const spec = { segments: [{ kind: "avatar", text: "hi", caption: "c" }] } as unknown as Spec;
    const project = { assetPath: (r: string) => "/nope/" + r } as unknown as Parameters<typeof validateSpec>[2];
    expect(() => validateSpec(spec, DEFAULT_BRAND, project)).not.toThrow();
  });
});

describe("kino brand", () => {
  it("formats a brand's frontmatter summary + guidelines body", () => {
    const dir = brandDirWith('---\nname: acme\ncolors: { mint: "#0f0" }\ndefaultVoice: v1\n---\n# Acme\n- be punchy\n');
    const t = brandText(dir);
    expect(t).toMatch(/acme/);
    expect(t).toMatch(/#0f0/);
    expect(t).toMatch(/be punchy/); // the guidelines body is printed
  });
  it("lists brand names that have a brand.md", () => {
    const dir = brandDirWith("---\nname: acme\n---\nx\n");
    const brandsRoot = join(dir, "..");
    expect(listBrands(brandsRoot)).toContain("acme");
  });
});
