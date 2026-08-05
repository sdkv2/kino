import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assembleTransitionSource, transitionParamNames, transitionColorNames, parseHexColor, TRANSITION_PARAM_SLOTS, TRANSITION_COLOR_SLOTS } from "../src/render/transitionSource.js";
import { resolveTransitionSource, listTransitionIds } from "../src/media/transitionLib.js";
import { transitionCustomForWindow, brandPalette } from "../src/render/transitionSpec.js";
import { assertTransitions } from "../src/spec/validate.js";
import type { KinoProps } from "../src/render/props.js";
import type { Spec } from "../src/spec/schema.js";

describe("transitionParamNames", () => {
  it("takes numeric keys only, alphabetically, so a slot is stable across frames", () => {
    expect(transitionParamNames({ zoom: 2, alpha: 1, label: "no" })).toEqual(["alpha", "zoom"]);
  });
  it("caps at the available uniform slots", () => {
    const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`p${i}`, i]));
    expect(transitionParamNames(many)).toHaveLength(TRANSITION_PARAM_SLOTS);
  });
});

describe("assembleTransitionSource", () => {
  const body = "void mainImage(out vec4 c, in vec2 f){ c = kinoTo(kinoUv(f)); }";

  it("wraps the author body into a compilable shader with the entry point", () => {
    const src = assembleTransitionSource(body, []);
    expect(src.startsWith("#version 300 es")).toBe(true);
    expect(src).toContain(body);
    expect(src).toContain("void main() { mainImage(kino_fragColor, gl_FragCoord.xy); }");
  });

  it("exposes both beats, progress and resolution", () => {
    const src = assembleTransitionSource(body);
    for (const decl of ["uniform sampler2D uFrom", "uniform sampler2D uTo", "uniform float uP", "uniform vec2  uRes"]) {
      expect(src).toContain(decl);
    }
    expect(src).toContain("vec4 kinoFrom(vec2 uv)");
    expect(src).toContain("vec4 kinoTo(vec2 uv)");
    expect(src).toContain("vec2 kinoUv(vec2 fragCoord)");
  });

  it("aliases each param to its slot, so authors write u_<name> not uParamN", () => {
    const src = assembleTransitionSource(body, ["alpha", "zoom"]);
    expect(src).toContain("#define u_alpha uParam0");
    expect(src).toContain("#define u_zoom uParam1");
  });

  it("skips an alias for a name that isn't a GLSL identifier rather than emitting broken source", () => {
    expect(assembleTransitionSource(body, ["not-an-ident"])).not.toContain("#define u_not-an-ident");
  });

  it("restates the endpoint contract where the author will see it", () => {
    expect(assembleTransitionSource(body)).toMatch(/exactly kinoFrom\(uv\) at uP=0/);
  });
});

describe("resolveTransitionSource", () => {
  const project = { assetPath: (r: string) => join("/nope", r), workspaceRoot: "/nope" };

  it("resolves a bare id against the shipped library", () => {
    expect(listTransitionIds()).toContain("iris");
    // Separators normalised before matching: resolveTransitionSource returns a NATIVE path, so on
    // Windows this is `...\assets-lib\transitions\iris.frag` and a forward-slash pattern can never
    // match it. The assertion is about which file was resolved, not how the OS spells a path.
    expect(resolveTransitionSource("iris", project).replace(/\\/g, "/")).toMatch(/assets-lib\/transitions\/iris\.frag$/);
  });

  it("names the library contents when an id is unknown", () => {
    expect(() => resolveTransitionSource("nope", project)).toThrow(/Unknown transition id "nope".*iris/s);
  });

  it("resolves a project assets/ path", () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-tx-"));
    mkdirSync(join(dir, "transitions"));
    writeFileSync(join(dir, "transitions/my.frag"), "// x");
    const p = { assetPath: (r: string) => join(dir, r), workspaceRoot: dir };
    expect(resolveTransitionSource("transitions/my.frag", p)).toBe(join(dir, "transitions/my.frag"));
  });
});

describe("transitionCustomForWindow", () => {
  const win = { from: "beat0", to: "beat1", p: 0.5 };
  const props = (seg1: Record<string, unknown>) =>
    ({
      fps: 30,
      theme: { mint: "#80e2b4" },
      segments: [{ kind: "motion", startSec: 0, endSec: 3, motion: {} }, { kind: "motion", startSec: 3, endSec: 6, motion: {}, ...seg1 }],
    }) as unknown as KinoProps;

  it("is undefined for a built-in transition", () => {
    expect(transitionCustomForWindow(props({ transition: "wipe-down" }), win)).toBeUndefined();
  });

  it("assembles the author's source and packs params into matching slots", () => {
    const c = transitionCustomForWindow(
      props({ transition: "custom", transitionSource: "void mainImage(out vec4 c, in vec2 f){}", transitionParams: { zoom: 3, alpha: 1 } }),
      win,
    )!;
    expect(c.source).toContain("#define u_alpha uParam0");
    expect(c.source).toContain("#define u_zoom uParam1");
    expect(c.params).toEqual([1, 3]); // alphabetical, matching the aliases
  });

  it("ignores non-numeric params rather than passing NaN to a uniform", () => {
    const c = transitionCustomForWindow(
      props({ transition: "custom", transitionSource: "void mainImage(out vec4 c, in vec2 f){}", transitionParams: { label: "hi", a: 2 } }),
      win,
    )!;
    expect(c.params).toEqual([2]);
  });
});

describe("assertTransitions", () => {
  const project = { assetPath: (r: string) => join("/nope", r), workspaceRoot: "/nope" };
  const spec = (seg: Record<string, unknown>) => ({ segments: [{ kind: "motion", source: "x.html", dur: 2, ...seg }] }) as unknown as Spec;

  it("accepts a custom transition whose source resolves", () => {
    expect(() => assertTransitions(spec({ transition: "custom", transitionSource: "iris" }), project)).not.toThrow();
  });

  it("rejects transition:custom with no source", () => {
    expect(() => assertTransitions(spec({ transition: "custom" }), project)).toThrow(/needs transitionSource/);
  });

  it("rejects a transitionSource without transition:custom, which would be silently ignored", () => {
    expect(() => assertTransitions(spec({ transition: "wipe-down", transitionSource: "iris" }), project)).toThrow(
      /transitionSource needs transition:"custom"/,
    );
  });

  it("rejects an unresolvable custom source, naming the beat", () => {
    expect(() => assertTransitions(spec({ transition: "custom", transitionSource: "ghost" }), project)).toThrow(
      /segment\[0\].*Unknown transition id "ghost"/s,
    );
  });

  // transitionParams must accept unknown keys (a custom shader names its own), so the typo check
  // has to live here, where the transition kind is known.
  it("rejects a misspelled wipe knob instead of silently ignoring it", () => {
    expect(() => assertTransitions(spec({ transition: "wipe-down", transitionParams: { softnes: 0.1 } }), project)).toThrow(
      /"softnes" is not a knob/,
    );
  });

  it("accepts the real wipe knobs", () => {
    expect(() =>
      assertTransitions(spec({ transition: "wipe", transitionParams: { angle: 45, softness: 0.1, edgeWidth: 0, edgeColor: "#fff", edgeGain: 1 } }), project),
    ).not.toThrow();
  });

  it("lets a custom shader name whatever params it likes", () => {
    expect(() =>
      assertTransitions(spec({ transition: "custom", transitionSource: "iris", transitionParams: { whatever: 3, mood: "x" } }), project),
    ).not.toThrow();
  });

  it("rejects params on a transition that has none", () => {
    expect(() => assertTransitions(spec({ transition: "fade", transitionParams: { angle: 90 } }), project)).toThrow(/would ignore it/);
  });
});

describe("optional params (zero-fill)", () => {
  // Without this, a param is only optional in theory: `u_bleed` is a bare identifier, so omitting
  // `bleed` from transitionParams is a GLSL compile error that kills the whole render. Every param
  // would be mandatory in practice, and no shipped shader could be reused with fewer knobs.
  const body = "void mainImage(out vec4 c, in vec2 f){ float a = u_bleed; float b = u_glow; c = kinoTo(kinoUv(f)); }";

  it("defines every referenced param the spec omitted, so the shader still compiles", () => {
    const src = assembleTransitionSource(body, []);
    expect(src).toContain("#define u_bleed 0.0");
    expect(src).toContain("#define u_glow 0.0");
  });

  it("does not shadow a param the spec DID declare", () => {
    const src = assembleTransitionSource(body, ["bleed"]);
    expect(src).toContain("#define u_bleed uParam0");
    expect(src).not.toContain("#define u_bleed 0.0");
    expect(src).toContain("#define u_glow 0.0"); // the other one is still filled
  });

  it("every shipped library shader compiles with NO transitionParams at all", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { TRANSITION_LIB_DIR } = await import("../src/media/transitionLib.js");
    const ids = listTransitionIds();
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      const file = readdirSync(TRANSITION_LIB_DIR).find((f) => f.startsWith(`${id}.`))!;
      const src = assembleTransitionSource(readFileSync(join(TRANSITION_LIB_DIR, file), "utf8"), []);
      // Every u_ the shader reads must resolve to either a slot alias or the zero filler.
      // Comments stripped first: this scans for params the shader READS, and a `u_name` that only
      // appears in prose is not one. Without this, documenting the param idiom in a helper comment
      // fails the sweep for a name no line of GLSL ever evaluates.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      for (const m of code.matchAll(/\bu_([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
        expect(code, `u_${m[1]} is read but never defined`).toMatch(new RegExp(`#define u_${m[1]} `));
      }
    }
  });
});

describe("brand palette in custom transitions", () => {
  it("declares the five palette roles as uniforms", () => {
    const src = assembleTransitionSource("void mainImage(out vec4 c, in vec2 f){}");
    for (const u of ["uBrandBg", "uBrandFg", "uBrandAccent", "uBrandAccent2", "uBrandDeep"]) {
      expect(src).toMatch(new RegExp(`uniform vec3\\s+${u};`));
    }
  });

  it("resolves the palette from the theme, as shader-ready rgb", () => {
    const p = brandPalette({ bg: "#000000", fg: "#ffffff", accent: "#ff0000", accent2: "#00ff00", deep: "#0000ff" } as never);
    expect(p.bg).toEqual([0, 0, 0]);
    expect(p.fg).toEqual([1, 1, 1]);
    expect(p.accent).toEqual([1, 0, 0]);
    expect(p.accent2).toEqual([0, 1, 0]);
    expect(p.deep).toEqual([0, 0, 1]);
  });

  // The whole point of the change: a shipped transition must pigment itself from the brand, not
  // from a literal. Both of these used to hard-code the house mint / amber, so a brand that was
  // neither got someone else's colour bled across its cut.
  it("pigments the shipped shaders from the brand, overridable per spec", () => {
    const project = { assetPath: (r: string) => join("/nope", r), workspaceRoot: "/nope" };
    const shipped = [
      ["organic-inkbleed", "uBrandAccent"],
      ["film-scorch", "uBrandAccent2"],
      ["geo-facade", "uBrandAccent"],
      ["crt-collapse", "uBrandAccent"],
      ["paper-tear", "uBrandFg"],
      ["glide-parallax", "uBrandAccent"],
      ["optic-prism", "uBrandAccent"],
      ["rack-focus", "uBrandAccent"],
    ] as const;
    for (const [id, role] of shipped) {
      const code = readFileSync(resolveTransitionSource(id, project), "utf8").replace(/\/\/.*$/gm, "");
      expect(code, `${id} must take its hue from the brand`).toContain(role);
      // Via kinoPick, so the spec can override it — a bare uBrand* read would be brand-locked.
      expect(code.match(/kinoPick\(\s*u_[A-Za-z0-9_]+\s*,\s*uBrand/), `${id} must pigment through kinoPick(u_<name>, uBrand…)`).toBeTruthy();
    }
  });
});


describe("colour params (the colour rule)", () => {
  it("parses #rgb and #rrggbb, rejects anything else", () => {
    expect(parseHexColor("#fff")).toEqual([1, 1, 1]);
    expect(parseHexColor("#ff0000")).toEqual([1, 0, 0]);
    expect(parseHexColor("000000")).toEqual([0, 0, 0]);
    expect(parseHexColor("#ff00")).toBeNull();
    expect(parseHexColor("rebeccapurple")).toBeNull();
  });

  it("takes hex string keys only, alphabetically, capped at the colour slots", () => {
    expect(transitionColorNames({ ink: "#fff", heat: 1.2, mood: "loud", bevel: "#000" })).toEqual(["bevel", "ink"]);
    const many = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`c${i}`, "#fff"]));
    expect(transitionColorNames(many)).toHaveLength(TRANSITION_COLOR_SLOTS);
  });

  it("aliases colours to vec3 slots, separate from the float slots", () => {
    const src = assembleTransitionSource("void mainImage(out vec4 c, in vec2 f){}", ["heat"], ["fire"]);
    expect(src).toContain("#define u_heat uParam0");
    expect(src).toContain("#define u_fire uColor0");
    expect(src).toContain("uniform vec3  uColor0;");
  });

  // The sentinel is what makes "omitted" distinguishable from "black", so kinoPick can fall back to
  // the brand without stealing #000 from anyone who genuinely wants it.
  it("fills an omitted kinoPick colour with the negative sentinel, not 0.0", () => {
    const src = assembleTransitionSource("void mainImage(out vec4 c, in vec2 f){ vec3 i = kinoPick(u_ink, uBrandAccent); }");
    expect(src).toContain("#define u_ink vec3(-1.0)");
    expect(src).not.toContain("#define u_ink 0.0");
  });

  it("still fills a non-colour param with 0.0, so the float idiom is unchanged", () => {
    const src = assembleTransitionSource("void mainImage(out vec4 c, in vec2 f){ float h = u_heat; }");
    expect(src).toContain("#define u_heat 0.0");
  });

  it("ships kinoPick so every author gets the rule without writing it", () => {
    expect(assembleTransitionSource("void mainImage(out vec4 c, in vec2 f){}")).toContain("vec3 kinoPick(vec3 c, vec3 fallback)");
  });

  it("hands the compositor parsed rgb for each declared colour", () => {
    const win = { from: "beat0", to: "beat1", p: 0.5 };
    const props = {
      fps: 30,
      theme: { bg: "#000", fg: "#fff", accent: "#f00", accent2: "#0f0", deep: "#00f" },
      segments: [
        { kind: "motion", startSec: 0, endSec: 3, motion: {} },
        { kind: "motion", startSec: 3, endSec: 6, motion: {}, transition: "custom",
          transitionSource: "void mainImage(out vec4 c, in vec2 f){ vec3 i = kinoPick(u_ink, uBrandAccent); }",
          transitionParams: { ink: "#ff00aa", heat: 2 } },
      ],
    } as unknown as KinoProps;
    const c = transitionCustomForWindow(props, win)!;
    expect(c.colors).toEqual([[1, 0, 2 / 3]]);
    expect(c.params).toEqual([2]);
    expect(c.source).toContain("#define u_ink uColor0");
    expect(c.brand.accent).toEqual([1, 0, 0]);
  });
});
