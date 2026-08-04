// The UI roles: the six a motion graphic needs before it can fabricate a product surface without
// hard-coding hexes, and the derivation that keeps them from being six more required fields.
//
// The design property under test everywhere here is DERIVATION: every existing brand, preset and
// spec declares five colours, so the six new ones have to come out of those five at a value close
// enough to what an author would have hand-picked, and have to invert correctly on a light scheme
// without a branch.
import { describe, it, expect } from "vitest";
import {
  derivePalette,
  normalizeUiColors,
  resolvePalette,
  PALETTE_PRESETS,
  UI_ROLES,
  type Palette,
} from "../src/config/palettes.js";
import { contrastRatio, relativeLuminance } from "../src/render/contrast.js";
import { buildMotionVars, uiPalette, motionFrameState } from "../src/render/motionVars.js";
import type { Theme } from "../src/render/props.js";

const dark = PALETTE_PRESETS.midnight as Palette;
const light = PALETTE_PRESETS.paper as Palette;

describe("derivePalette", () => {
  it("fills every UI role", () => {
    const p = derivePalette(dark);
    for (const role of UI_ROLES) expect(p[role]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("keeps the five core roles untouched", () => {
    expect(derivePalette(dark)).toMatchObject(dark);
  });

  it("raises a panel off a dark page and settles one onto a light page", () => {
    // Both are "a plane distinct from the page" — which on a dark base means lighter and on a light
    // base means a shade darker, exactly as light design systems draw a subtle panel on white.
    expect(relativeLuminance(derivePalette(dark).surface)).toBeGreaterThan(relativeLuminance(dark.bg));
    expect(relativeLuminance(derivePalette(light).surface)).toBeLessThan(relativeLuminance(light.bg));
  });

  it("puts the rule between the page and the panel's own contrast, in both directions", () => {
    for (const core of [dark, light]) {
      const p = derivePalette(core);
      const away = (hex: string) => Math.abs(relativeLuminance(hex) - relativeLuminance(core.bg));
      expect(away(p.line)).toBeGreaterThan(away(p.surface));
      expect(away(p.line)).toBeLessThan(away(core.fg));
    }
  });

  it("makes secondary ink quieter than the primary but still readable", () => {
    for (const core of [dark, light]) {
      const p = derivePalette(core);
      expect(contrastRatio(p.muted, core.bg)).toBeLessThan(contrastRatio(core.fg, core.bg));
      expect(contrastRatio(p.muted, core.bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("holds the semantic triad legible on the page it landed on", () => {
    for (const core of [dark, light]) {
      const p = derivePalette(core);
      for (const role of ["ok", "warn", "danger"] as const) {
        expect(contrastRatio(p[role], core.bg)).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("leaves the stock triad exactly as authored on a dark page", () => {
    // The adjustment is for light schemes; a dark palette must not drift.
    const p = derivePalette(dark);
    expect([p.ok, p.warn, p.danger]).toEqual(["#22c55e", "#f59e0b", "#ef4444"]);
  });

  it("does not derive the semantics FROM the brand — a state colour that moves stops meaning one", () => {
    const weird = { ...dark, accent: "#ff00ff", accent2: "#00ffff", deep: "#123456" };
    expect(derivePalette(weird).ok).toBe(derivePalette(dark).ok);
  });

  it("honours anything explicitly set", () => {
    const p = derivePalette(dark, { line: "#2a2f3a", ok: "#3fb950" });
    expect(p.line).toBe("#2a2f3a");
    expect(p.ok).toBe("#3fb950");
    expect(p.surface).toBe(derivePalette(dark).surface);
  });
});

describe("normalizeUiColors", () => {
  it("picks only the UI roles, dropping the core ones and anything unset", () => {
    expect(normalizeUiColors({ line: "#111111", ok: "#222222" } as never)).toEqual({
      line: "#111111",
      ok: "#222222",
    });
    expect(normalizeUiColors({ bg: "#000000" } as never)).toEqual({});
  });
});

describe("UI roles vs the core-five resolver", () => {
  it("stay out of resolvePalette — a preset replaces five roles, not eleven", () => {
    const core = resolvePalette({ preset: "noir", line: "#2a2f3a" } as never, dark);
    expect(Object.keys(core).sort()).toEqual(["accent", "accent2", "bg", "deep", "fg"]);
  });

  it("survive a spec naming a preset, which is why they layer separately", () => {
    // The build layers brand-then-spec UI roles and hands them to derivePalette alongside whatever
    // core palette the preset produced — so a brand's border convention outlives a preset switch.
    const core = resolvePalette("noir", dark);
    expect(derivePalette(core, { line: "#2a2f3a" }).line).toBe("#2a2f3a");
  });
});

describe("the roles reach a motion graphic", () => {
  const theme = { ...dark, font: "Arial", captionFontSize: 74, captionStroke: 9 } as unknown as Theme;

  it("as --kino-* custom properties", () => {
    const vars = buildMotionVars(theme, { frame: 0, t: 0, progress: 0, pulse: 0, params: {} });
    expect(vars["--kino-surface"]).toBe(derivePalette(dark).surface);
    expect(vars["--kino-line"]).toBe(derivePalette(dark).line);
    expect(vars["--kino-danger"]).toBe(derivePalette(dark).danger);
  });

  it("as env.palette, with the same values the CSS gets", () => {
    const { env, vars } = motionFrameState(
      { params: {}, keyframes: [], words: [] },
      { local: 0, fps: 30, durationFrames: 30, theme, width: 1080, height: 1920 },
    );
    for (const role of UI_ROLES) expect(vars[`--kino-${role}`]).toBe(env.palette[role]);
  });

  it("resolves from a partial theme rather than emitting an undefined var", () => {
    // A hand-built props object (test fixtures, `kino still` on a bare theme) carries only the five
    // core roles. An unresolved var() takes the whole declaration — and the element's paint — with
    // it, so these have to derive here too.
    const bare = { bg: "#0b1020", fg: "#ffffff", accent: "#80e2b4", accent2: "#d99a20", deep: "#0c8d64" } as Theme;
    for (const role of UI_ROLES) expect(uiPalette(bare)[role]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("prefers what the theme carries over re-deriving", () => {
    const set = { ...theme, line: "#2a2f3a" } as Theme;
    expect(uiPalette(set).line).toBe("#2a2f3a");
  });

  it("survives a theme with NO role keys at all rather than taking the render down", () => {
    // Older fixtures carry only the pre-rename literal names, so every role key reads undefined.
    // Deriving from them must degrade (contrast.ts's "unparseable reads as black" policy), because
    // the alternative is a throw inside the page's first frame — which is how this was found.
    const legacy = { font: "Arial", night: "#0b1020", mint: "#80e2b4" } as unknown as Theme;
    expect(() => uiPalette(legacy)).not.toThrow();
    for (const role of UI_ROLES) expect(uiPalette(legacy)[role]).toMatch(/^#[0-9a-f]{6}$/);
  });
});
