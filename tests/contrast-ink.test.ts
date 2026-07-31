import { describe, it, expect } from "vitest";
import { contrastRatio, isLightSurface, readableInk, relativeLuminance, strokeInk } from "../src/render/contrast.js";
import { PALETTE_PRESETS, PALETTE_ROLES, type Palette } from "../src/config/palettes.js";
import { wordStyle } from "../src/render/textStyles.js";

const theme = (p: Palette) => ({ ...p, captionStroke: 9 });

describe("contrast primitives", () => {
  it("computes WCAG luminance and ratios", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
    expect(contrastRatio("#000", "#fff")).toBeCloseTo(21, 4);
    expect(contrastRatio("#123456", "#123456")).toBeCloseTo(1, 5);
  });

  it("expands 3-digit hex and reads unparseable input as black", () => {
    expect(relativeLuminance("#fff")).toBeCloseTo(relativeLuminance("#ffffff"), 9);
    expect(relativeLuminance("rebeccapurple")).toBe(0);
  });

  it("flags only the light preset as a light surface", () => {
    expect(isLightSurface(PALETTE_PRESETS.paper.bg)).toBe(true);
    expect(isLightSurface(PALETTE_PRESETS.midnight.bg)).toBe(false);
    expect(isLightSurface(PALETTE_PRESETS.noir.bg)).toBe(false);
  });
});

describe("readableInk (kicker chips)", () => {
  const { midnight, noir, paper } = PALETTE_PRESETS;
  const ink = (p: Palette, role: keyof Palette) => readableInk(p[role], p.fg, p.bg);

  // The old KICKER_FG table: accent → near-black, deep → white, accent2 → near-black. Deriving has
  // to reproduce that shape on the house palette or every existing kicker changes appearance.
  it("reproduces the house palette's inks", () => {
    expect(ink(midnight, "accent")).toBe(midnight.bg);
    expect(ink(midnight, "accent2")).toBe(midnight.bg);
    expect(ink(midnight, "deep")).toBe(midnight.fg);
  });

  it("keeps the deep chip on fg even though the base scores marginally higher", () => {
    // 4.18 (fg) vs 4.27 (bg) — raw max-contrast would flip this chip from white to near-black.
    expect(contrastRatio(midnight.deep, midnight.bg)).toBeGreaterThan(contrastRatio(midnight.deep, midnight.fg));
    expect(ink(midnight, "deep")).toBe(midnight.fg);
  });

  it("puts light ink on the light scheme's saturated accent", () => {
    expect(ink(paper, "accent")).toBe(paper.bg);
    expect(ink(paper, "deep")).toBe(paper.bg);
  });

  it("clears 4:1 on every chip of every preset", () => {
    for (const p of Object.values(PALETTE_PRESETS)) {
      for (const role of ["accent", "accent2", "deep"] as const) {
        expect(contrastRatio(p[role], readableInk(p[role], p.fg, p.bg))).toBeGreaterThanOrEqual(4);
      }
    }
    expect(ink(noir, "accent")).toBe(noir.bg);
  });
});

describe("strokeInk (caption halo)", () => {
  it("is byte-identical to the hardcoded #000 for every light-fg palette", () => {
    expect(strokeInk(PALETTE_PRESETS.midnight.fg)).toBe("#000");
    expect(strokeInk(PALETTE_PRESETS.noir.fg)).toBe("#000");
    expect(wordStyle("stroke", theme(PALETTE_PRESETS.midnight))).toMatchObject({ WebkitTextStroke: "9px #000" });
  });

  it("flips to a white halo when the ink itself is near-black", () => {
    expect(strokeInk(PALETTE_PRESETS.paper.fg)).toBe("#fff");
    expect(wordStyle("stroke", theme(PALETTE_PRESETS.paper))).toMatchObject({ WebkitTextStroke: "9px #fff" });
  });
});

describe("preset legibility", () => {
  it("every preset has role hexes and readable text on its own base", () => {
    for (const [name, p] of Object.entries(PALETTE_PRESETS)) {
      for (const role of PALETTE_ROLES) expect(p[role], `${name}.${role}`).toMatch(/^#[0-9a-f]{6}$/);
      expect(contrastRatio(p.fg, p.bg), `${name} fg on bg`).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(p.accent, p.bg), `${name} accent on bg`).toBeGreaterThanOrEqual(4.5);
      // `deep` is a fill, held only to the house palette's own baseline.
      expect(contrastRatio(p.deep, p.bg), `${name} deep on bg`).toBeGreaterThanOrEqual(3);
    }
  });

  it("the highlight caption style keeps its word legible in every preset", () => {
    for (const [name, p] of Object.entries(PALETTE_PRESETS)) {
      // wordStyle paints the active word as bg-on-accent.
      expect(contrastRatio(p.bg, p.accent), `${name} highlight word`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
