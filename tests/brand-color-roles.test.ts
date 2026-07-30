import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadBrand, DEFAULT_BRAND } from "../src/config/brand.js";
import { buildMotionVars } from "../src/render/motionVars.js";
import { SpecSchema } from "../src/spec/schema.js";
import type { Theme } from "../src/render/props.js";

function brandDirWith(md: string) {
  const root = mkdtempSync(join(tmpdir(), "kino-brand-roles-"));
  const dir = join(root, "brands", "acme");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "brand.md"), md);
  return dir;
}

describe("role-keyed brand colors", () => {
  it("DEFAULT_BRAND exposes the palette under role keys", () => {
    expect(DEFAULT_BRAND.colors.bg).toBe("#0b1020");
    expect(DEFAULT_BRAND.colors.fg).toBe("#ffffff");
    expect(DEFAULT_BRAND.colors.accent).toBe("#80e2b4");
    expect(DEFAULT_BRAND.colors.accent2).toBe("#d99a20");
    expect(DEFAULT_BRAND.colors.deep).toBe("#0c8d64");
  });

  it("parses role keys from brand.md", () => {
    const dir = brandDirWith('---\nname: acme\ncolors: { accent: "#2563eb", bg: "#111111" }\n---\nguide\n');
    const b = loadBrand(dir);
    expect(b.colors.accent).toBe("#2563eb");
    expect(b.colors.bg).toBe("#111111");
    expect(b.colors.fg).toBe(DEFAULT_BRAND.colors.fg); // defaulted
  });

  it("maps legacy literal keys onto the roles", () => {
    const dir = brandDirWith('---\nname: acme\ncolors: { mint: "#ff0000", night: "#222222", gold: "#00ff00", green: "#0000ff", white: "#eeeeee" }\n---\nguide\n');
    const b = loadBrand(dir);
    expect(b.colors.accent).toBe("#ff0000");
    expect(b.colors.bg).toBe("#222222");
    expect(b.colors.accent2).toBe("#00ff00");
    expect(b.colors.deep).toBe("#0000ff");
    expect(b.colors.fg).toBe("#eeeeee");
  });

  it("prefers a role key over its legacy alias when both are set", () => {
    const dir = brandDirWith('---\nname: acme\ncolors: { accent: "#2563eb", mint: "#80e2b4" }\n---\nguide\n');
    const b = loadBrand(dir);
    expect(b.colors.accent).toBe("#2563eb");
  });
});

describe("motion vars expose roles plus legacy aliases", () => {
  const theme = {
    font: "Inter",
    bg: "#0b1020",
    fg: "#ffffff",
    accent: "#2563eb",
    accent2: "#60a5fa",
    deep: "#1d4ed8",
    captionFontSize: 74,
    captionStroke: 9,
  } as unknown as Theme;
  const dyn = { frame: 0, t: 0, progress: 0, pulse: 0, params: {} };

  it("emits --kino-accent (and friends) with the legacy names as aliases", () => {
    const vars = buildMotionVars(theme, dyn);
    expect(vars["--kino-accent"]).toBe("#2563eb");
    expect(vars["--kino-mint"]).toBe("#2563eb");
    expect(vars["--kino-accent2"]).toBe("#60a5fa");
    expect(vars["--kino-gold"]).toBe("#60a5fa");
    expect(vars["--kino-deep"]).toBe("#1d4ed8");
    expect(vars["--kino-green"]).toBe("#1d4ed8");
    expect(vars["--kino-bg"]).toBe("#0b1020");
    expect(vars["--kino-night"]).toBe("#0b1020");
    expect(vars["--kino-fg"]).toBe("#ffffff");
    expect(vars["--kino-white"]).toBe("#ffffff");
  });
});

describe("kicker color accepts both vocabularies", () => {
  it("accepts role names", () => {
    const s = SpecSchema.parse({
      title: "t",
      segments: [{ kind: "video", source: "screens/x.png", text: "spoken line", kicker: { text: "hi", color: "accent2" } }],
    });
    expect(s.segments[0].kicker?.color).toBe("accent2");
  });

  it("still accepts legacy literal names", () => {
    const s = SpecSchema.parse({
      title: "t",
      segments: [{ kind: "video", source: "screens/x.png", text: "spoken line", kicker: { text: "hi", color: "gold" } }],
    });
    expect(s.segments[0].kicker?.color).toBe("gold");
  });
});
