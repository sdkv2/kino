import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadBrand, DEFAULT_BRAND, type Brand } from "../src/config/brand.js";
import { PALETTE_PRESETS, resolvePalette } from "../src/config/palettes.js";
import { assertColorScheme, assertLightSchemeFinish, validateSpec } from "../src/spec/validate.js";
import { SpecSchema } from "../src/spec/schema.js";
import { log } from "../src/log.js";
import type { Spec } from "../src/spec/schema.js";

function brandDirWith(md: string) {
  const root = mkdtempSync(join(tmpdir(), "kino-spec-colors-"));
  const dir = join(root, "brands", "acme");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "brand.md"), md);
  return dir;
}

const specOf = (extra: Record<string, unknown>) =>
  SpecSchema.parse({ title: "t", segments: [{ text: "hi" }], ...extra });

describe("resolvePalette", () => {
  const brandColors = { ...DEFAULT_BRAND.colors, accent: "#2563eb" };

  it("keeps the brand palette when the spec sets nothing", () => {
    expect(resolvePalette(undefined, brandColors)).toEqual(brandColors);
  });

  it("a named preset replaces every role, including ones the brand set", () => {
    expect(resolvePalette("noir", brandColors)).toEqual(PALETTE_PRESETS.noir);
  });

  it("role keys layer over the brand when no preset is named", () => {
    expect(resolvePalette({ deep: "#123456" }, brandColors)).toEqual({ ...brandColors, deep: "#123456" });
  });

  it("role keys layer over a named preset", () => {
    expect(resolvePalette({ preset: "paper", accent: "#ff0055" }, brandColors)).toEqual({
      ...PALETTE_PRESETS.paper,
      accent: "#ff0055",
    });
  });

  it("accepts the pre-rename literal names in a spec, same as brand.md", () => {
    const out = resolvePalette({ mint: "#ff0000", night: "#222222" }, brandColors);
    expect(out.accent).toBe("#ff0000");
    expect(out.bg).toBe("#222222");
  });

  it("prefers a role key over its own legacy alias", () => {
    expect(resolvePalette({ accent: "#111111", mint: "#999999" }, brandColors).accent).toBe("#111111");
  });

  it("does not mutate the preset it returns", () => {
    const p = resolvePalette("noir", brandColors);
    p.accent = "#000000";
    expect(PALETTE_PRESETS.noir.accent).toBe("#e0a83c");
  });
});

describe("spec.colors schema", () => {
  it("accepts a preset name, a role block, and a preset+override block", () => {
    expect(specOf({ colors: "paper" }).colors).toBe("paper");
    expect(specOf({ colors: { bg: "#000" } }).colors).toEqual({ bg: "#000" });
    expect(specOf({ colors: { preset: "noir", accent: "#ff0055" } }).colors).toEqual({ preset: "noir", accent: "#ff0055" });
  });

  it("rejects an unknown preset, a typo'd role, a non-hex value, and an empty block", () => {
    expect(() => specOf({ colors: "midnite" })).toThrow();
    expect(() => specOf({ colors: { acent: "#ffffff" } })).toThrow();
    expect(() => specOf({ colors: { accent: "rebeccapurple" } })).toThrow();
    expect(() => specOf({ colors: {} })).toThrow();
  });
});

describe("assertColorScheme", () => {
  afterEach(() => vi.restoreAllMocks());
  const noColors = { ...DEFAULT_BRAND };

  it("warns (does not throw) when neither the spec nor the brand declares a palette", () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
    expect(() => assertColorScheme(specOf({}), noColors)).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/No colour scheme/));
  });

  it("stays quiet on a spec preset, and on spec roles", () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
    assertColorScheme(specOf({ colors: "noir" }), noColors);
    assertColorScheme(specOf({ colors: { accent: "#ff0055" } }), noColors);
    expect(warn).not.toHaveBeenCalled();
  });

  it("stays quiet when a brand.md declares colors", () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
    const brand = loadBrand(brandDirWith('---\nname: acme\ncolors: { accent: "#2563eb" }\n---\nguide\n'));
    expect(brand.colorsDeclared).toBe(true);
    assertColorScheme(specOf({}), brand);
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns for a brand.md with no colors block — the house palette is not a choice", () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
    const brand = loadBrand(brandDirWith("---\nname: acme\nfont: Inter\n---\nguide\n"));
    expect(brand.colorsDeclared).toBe(false);
    expect(brand.colors).toEqual(DEFAULT_BRAND.colors);
    assertColorScheme(specOf({}), brand);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/No colour scheme/));
  });

  it("names both escapes and every preset", () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
    assertColorScheme(specOf({}), noColors);
    const msg = warn.mock.calls[0][0] as string;
    expect(msg).toMatch(/"midnight" \| "noir" \| "paper"/);
    expect(msg).toMatch(/brand/);
  });

  it("does not fail the build — a brandless, colourless spec still validates", () => {
    const spec = { title: "t", segments: [{ text: "hi" }] } as unknown as Spec;
    const project = { assetPath: (r: string) => "/nope/" + r } as unknown as Parameters<typeof validateSpec>[2];
    vi.spyOn(log, "warn").mockImplementation(() => {});
    expect(() => validateSpec(SpecSchema.parse(spec), noColors, project)).not.toThrow();
  });
});

describe("assertLightSchemeFinish", () => {
  afterEach(() => vi.restoreAllMocks());

  const withBg = (bg: string): Brand => ({ ...DEFAULT_BRAND, colors: { ...DEFAULT_BRAND.colors, bg } });

  it("warns on a light base with the film finish left on", () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
    assertLightSchemeFinish(specOf({ colors: "paper" }), withBg(PALETTE_PRESETS.paper.bg));
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/film.*0/s));
  });

  it("stays quiet on a light base with film 0, and on every dark preset", () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
    assertLightSchemeFinish(specOf({ colors: "paper", film: 0 }), withBg(PALETTE_PRESETS.paper.bg));
    assertLightSchemeFinish(specOf({ colors: "midnight" }), withBg(PALETTE_PRESETS.midnight.bg));
    assertLightSchemeFinish(specOf({ colors: "noir" }), withBg(PALETTE_PRESETS.noir.bg));
    expect(warn).not.toHaveBeenCalled();
  });
});
