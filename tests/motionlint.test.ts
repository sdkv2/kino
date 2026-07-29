import { describe, it, expect } from "vitest";
import { lintPinnedClamps, lintDeadVisuals } from "../src/render/motionLint.js";
import { lintMotionSource } from "../src/render/motiongraphic.js";

describe("lintPinnedClamps", () => {
  it("flags the max-below-min form that pins the value to the min", () => {
    // The real defect: a whole beat's signature effect invisible in every frame.
    const css = ".smear { opacity: clamp(0, calc((var(--progress) - .22) * 5.5), 0); }";
    const found = lintPinnedClamps(css);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/pinned to 0/);
    expect(found[0]).toMatch(/UPPER bound/);
  });

  it("flags equal bounds too — the middle value is still ignored", () => {
    expect(lintPinnedClamps("a { opacity: clamp(1, var(--x), 1); }")).toHaveLength(1);
  });

  it("passes the correct form", () => {
    expect(lintPinnedClamps(".glyph { opacity: clamp(0, calc(1 - var(--progress)), 1); }")).toEqual([]);
  });

  it("handles nested parens and commas in the middle argument", () => {
    // A top-level-comma split is required: var(--d, .5) and calc() both contain commas/parens.
    const css = "a { opacity: clamp(0, calc(var(--progress) * var(--k, 2)), 1); }";
    expect(lintPinnedClamps(css)).toEqual([]);
    const bad = "a { opacity: clamp(0, calc(var(--progress) * var(--k, 2)), 0); }";
    expect(lintPinnedClamps(bad)).toHaveLength(1);
  });

  it("compares units and ignores mismatched or un-evaluatable bounds", () => {
    expect(lintPinnedClamps("a { width: clamp(10px, 5vw, 5px); }")).toHaveLength(1);
    // Different units — not statically decidable, so not flagged.
    expect(lintPinnedClamps("a { width: clamp(10px, 5vw, 2rem); }")).toEqual([]);
    // A var() bound can't be judged at lint time.
    expect(lintPinnedClamps("a { opacity: clamp(0, var(--x), var(--hi)); }")).toEqual([]);
  });

  it("finds every occurrence, including several in one rule block", () => {
    const css = "a{opacity:clamp(0,var(--a),0)} b{opacity:clamp(0,var(--b),0)} c{opacity:clamp(0,var(--c),1)}";
    expect(lintPinnedClamps(css)).toHaveLength(2);
  });

  it("ignores the 2-arg and 1-arg forms and unbalanced parens", () => {
    expect(lintPinnedClamps("a { opacity: clamp(0, 1); }")).toEqual([]);
    expect(lintPinnedClamps("a { opacity: clamp(0, var(--x), 1; }")).toEqual([]);
  });

  it("accepts signed and decimal bounds", () => {
    expect(lintPinnedClamps("a { translate: clamp(-1, var(--x), -2); }")).toHaveLength(1);
    expect(lintPinnedClamps("a { opacity: clamp(.5, var(--x), .25); }")).toHaveLength(1);
    expect(lintPinnedClamps("a { opacity: clamp(.25, var(--x), .5); }")).toEqual([]);
  });
});

describe("lintDeadVisuals via lintMotionSource", () => {
  it("rejects a pinned clamp in a Tier-1 HTML source", () => {
    const html = "<style>.s{opacity:clamp(0,var(--progress),0)}</style><div class='s'></div>";
    expect(lintMotionSource("motion/x.html", html).join(" ")).toMatch(/pinned to 0/);
  });

  it("rejects a pinned clamp emitted from a Tier-2 JS source", () => {
    const js = "function render(env){return '<style>.s{opacity:clamp(0,var(--t),0)}</style>'}";
    expect(lintMotionSource("motion/x.js", js).join(" ")).toMatch(/pinned to 0/);
  });

  it("leaves a clean source clean", () => {
    const html = "<style>.s{opacity:clamp(0,var(--progress),1)}</style><div class='s'></div>";
    expect(lintMotionSource("motion/x.html", html)).toEqual([]);
  });

  it("is exported as the aggregate check", () => {
    expect(lintDeadVisuals("a{opacity:clamp(0,var(--x),0)}")).toHaveLength(1);
  });
});
