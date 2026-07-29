import { describe, it, expect } from "vitest";
import {
  applyPathMorphs,
  evalMorphDriver,
  formatPathD,
  lintPathMorphs,
  morphPathD,
  parsePathD,
  structureMismatch,
} from "../src/render/pathMorph.js";
import { lintMotionSource } from "../src/render/motiongraphic.js";
import { motionHelpText } from "../src/commands/motion.js";

describe("parsePathD", () => {
  it("splits commands and coordinates", () => {
    expect(parsePathD("M0,0 L10,0 Z")).toEqual([
      { cmd: "M", args: [0, 0] },
      { cmd: "L", args: [10, 0] },
      { cmd: "Z", args: [] },
    ]);
  });

  it("expands repeated argument groups into separate commands", () => {
    // Structure comparison is only meaningful if these two spellings of the same path compare equal.
    expect(parsePathD("M0,0L1,1L2,2")).toEqual(parsePathD("M0,0 1,1 2,2"));
  });

  it("keeps command case — absolute and relative are different geometry", () => {
    expect(parsePathD("m1,1 l2,2").map((c) => c.cmd)).toEqual(["m", "l"]);
  });

  it("reads packed and signed numbers without separators", () => {
    expect(parsePathD("M-1.5-2.5L.5.25")).toEqual([
      { cmd: "M", args: [-1.5, -2.5] },
      { cmd: "L", args: [0.5, 0.25] },
    ]);
  });

  it("reads exponents", () => {
    expect(parsePathD("M1e2,2e-1")).toEqual([{ cmd: "M", args: [100, 0.2] }]);
  });

  it("reads arc flags as single digits even when packed against the next number", () => {
    // "0 1 1 1" spelled "011 1": the two flags must not be swallowed by the number scanner, and the
    // digits after them are a coordinate ("0111 1" is flag 0, flag 1, x 11, y 1 — not 0,1,1,1).
    expect(parsePathD("M0,0A5,5 0 011 1")).toEqual([
      { cmd: "M", args: [0, 0] },
      { cmd: "A", args: [5, 5, 0, 0, 1, 1, 1] },
    ]);
    expect(parsePathD("M0,0A5,5 0 0111 1")[1].args).toEqual([5, 5, 0, 0, 1, 11, 1]);
  });

  it("rejects malformed input rather than guessing", () => {
    expect(() => parsePathD("10,10 L2,2")).toThrow(/must start with a command letter/);
    expect(() => parsePathD("M0,0 K5,5")).toThrow(/unknown path command "K"/);
    expect(() => parsePathD("M0,0 L5")).toThrow(/expected a number/);
    expect(() => parsePathD("M0,0 Z 4,4")).toThrow(/must start with a command letter|expected/);
    expect(() => parsePathD("   ")).toThrow(/empty path data/);
  });
});

describe("structureMismatch", () => {
  const p = parsePathD;

  it("passes matching structures", () => {
    expect(structureMismatch(p("M0,0 C1,1 2,2 3,3 Z"), p("M9,9 C8,8 7,7 6,6 Z"))).toBeNull();
  });

  it("names a differing count", () => {
    expect(structureMismatch(p("M0,0 L1,1"), p("M0,0 L1,1 L2,2"))).toMatch(/command count differs — "from" has 2, "to" has 3/);
  });

  it("names the differing command and its position", () => {
    expect(structureMismatch(p("M0,0 L1,1"), p("M0,0 C1,1 2,2 3,3"))).toMatch(/command 2 differs — "from" has "L", "to" has "C"/);
  });

  it("rejects a relative/absolute swap", () => {
    expect(structureMismatch(p("M0,0 L1,1"), p("M0,0 l1,1"))).toMatch(/absolute vs relative/);
  });

  it("refuses to interpolate arc flags, naming which one", () => {
    expect(structureMismatch(p("M0,0 A5,5 0 0 1 1,1"), p("M0,0 A5,5 0 1 1 1,1"))).toMatch(/large-arc/);
    expect(structureMismatch(p("M0,0 A5,5 0 0 1 1,1"), p("M0,0 A5,5 0 0 0 1,1"))).toMatch(/sweep/);
    // Equal flags interpolate fine — only the five real numbers move.
    expect(structureMismatch(p("M0,0 A5,5 0 0 1 1,1"), p("M0,0 A9,9 0 0 1 4,4"))).toBeNull();
  });
});

describe("morphPathD", () => {
  it("passes through the endpoints at t=0 and t=1", () => {
    expect(morphPathD("M0,0 L10,0Z", "M2,2 L20,4Z", 0)).toBe(formatPathD(parsePathD("M0,0 L10,0Z")));
    expect(morphPathD("M0,0 L10,0Z", "M2,2 L20,4Z", 1)).toBe(formatPathD(parsePathD("M2,2 L20,4Z")));
  });

  it("produces a genuine intermediate shape, not a cut", () => {
    // The whole point: at the midpoint the path is neither endpoint.
    const mid = morphPathD("M0,0 L10,0Z", "M0,0 L10,10Z", 0.5);
    expect(mid).toBe("M0 0 L10 5 Z");
  });

  it("is monotonic across the drive, so a storyboard shows the shape travelling", () => {
    const at = (t: number) => Number(/L10 ([\d.]+)/.exec(morphPathD("M0,0 L10,0Z", "M0,0 L10,10Z", t))![1]);
    const samples = [0, 0.25, 0.5, 0.75, 1].map(at);
    expect(samples).toEqual([0, 2.5, 5, 7.5, 10]);
  });

  it("clamps the driver — an overshoot curve must not fling control points past the target", () => {
    expect(morphPathD("M0,0 L10,0Z", "M0,0 L10,10Z", 1.4)).toBe(morphPathD("M0,0 L10,0Z", "M0,0 L10,10Z", 1));
    expect(morphPathD("M0,0 L10,0Z", "M0,0 L10,10Z", -0.3)).toBe(morphPathD("M0,0 L10,0Z", "M0,0 L10,10Z", 0));
  });

  it("throws the mismatch message instead of silently cutting between shapes", () => {
    expect(() => morphPathD("M0,0 L1,1", "M0,0 C1,1 2,2 3,3", 0.5)).toThrow(/command 2 differs/);
  });

  it("holds an equal arc flag rather than interpolating it to a fraction", () => {
    expect(morphPathD("M0,0 A5,5 0 0 1 1,1", "M0,0 A9,9 0 0 1 5,5", 0.5)).toBe("M0 0 A7 7 0 0 1 3 3");
  });

  it("is a pure function of its inputs — same call, same bytes", () => {
    const a = morphPathD("M0,0 C1,2 3,4 5,6", "M1,1 C2,3 4,5 6,7", 1 / 3);
    const b = morphPathD("M0,0 C1,2 3,4 5,6", "M1,1 C2,3 4,5 6,7", 1 / 3);
    expect(a).toBe(b);
    // Rounded output, so no platform-dependent float printing reaches the markup.
    expect(a).toBe("M0.3333 0.3333 C1.3333 2.3333 3.3333 4.3333 5.3333 6.3333");
  });
});

describe("evalMorphDriver", () => {
  const vars = { "--morph": "0.4", "--progress": "0.250000", "--pct": "86" };

  it("reads a bare number", () => {
    expect(evalMorphDriver("0.75", vars)).toBe(0.75);
    expect(evalMorphDriver(" .5 ", vars)).toBe(0.5);
  });

  it("reads a kino variable", () => {
    expect(evalMorphDriver("var(--morph)", vars)).toBeCloseTo(0.4);
    expect(evalMorphDriver("var(--progress)", vars)).toBeCloseTo(0.25);
  });

  it("uses the fallback when the variable is absent", () => {
    expect(evalMorphDriver("var(--nope, 0.9)", vars)).toBeCloseTo(0.9);
  });

  it("supports calc/clamp/min/max so one driver can stagger a row of morphs", () => {
    expect(evalMorphDriver("calc((var(--progress) - 0.1) * 4)", vars)).toBeCloseTo(0.6);
    expect(evalMorphDriver("clamp(0, calc(var(--progress) * 10), 1)", vars)).toBeCloseTo(1);
    expect(evalMorphDriver("min(var(--morph), 0.1)", vars)).toBeCloseTo(0.1);
    expect(evalMorphDriver("max(var(--morph), 0.9)", vars)).toBeCloseTo(0.9);
    expect(evalMorphDriver("1 - var(--morph)", vars)).toBeCloseTo(0.6);
  });

  it("honours multiplication before addition", () => {
    expect(evalMorphDriver("1 + 2 * 3", vars)).toBe(7);
    expect(evalMorphDriver("(1 + 2) * 3", vars)).toBe(9);
    expect(evalMorphDriver("-var(--morph) + 1", vars)).toBeCloseTo(0.6);
  });

  it("names the missing variable rather than quietly morphing to 0", () => {
    expect(() => evalMorphDriver("var(--typo)", vars)).toThrow(/--typo is not a kino variable/);
  });

  it("rejects units — the driver is a unitless 0 → 1", () => {
    expect(() => evalMorphDriver("40%", vars)).toThrow(/unitless/);
  });

  it("rejects junk", () => {
    expect(() => evalMorphDriver("", vars)).toThrow(/empty morph driver/);
    expect(() => evalMorphDriver("var(--morph", vars)).toThrow(/unclosed/);
    expect(() => evalMorphDriver("clamp(0, 1)", vars)).toThrow(/three arguments/);
    expect(() => evalMorphDriver("0.5 0.5", vars)).toThrow(/unexpected/);
    expect(() => evalMorphDriver("1 / 0", vars)).toThrow(/finite/);
  });

  it("treats unknown variables as 0 in lint mode, where no frame exists yet", () => {
    expect(evalMorphDriver("calc(var(--whatever) + 0.5)", {}, "zero")).toBe(0.5);
  });
});

describe("applyPathMorphs", () => {
  const vars = { "--progress": "0.5", "--morph": "1" };

  it("writes the interpolated d and leaves everything else alone", () => {
    const html =
      '<svg viewBox="0 0 10 10"><path fill="#fff" data-kino-morph-from="M0,0 L10,0Z" data-kino-morph-to="M0,0 L10,10Z"/></svg>';
    const out = applyPathMorphs(html, vars);
    expect(out.errors).toEqual([]);
    expect(out.html).toContain('d="M0 0 L10 5 Z"');
    expect(out.html).toContain('fill="#fff"');
    expect(out.html).toContain('<svg viewBox="0 0 10 10">');
  });

  it("defaults the driver to --progress and honours an explicit one", () => {
    const mk = (t: string) =>
      applyPathMorphs(`<path ${t} data-kino-morph-from="M0,0 L10,0Z" data-kino-morph-to="M0,0 L10,10Z"/>`, vars).html;
    expect(mk("")).toContain('d="M0 0 L10 5 Z"');
    expect(mk('data-kino-morph-t="var(--morph)"')).toContain('d="M0 0 L10 10 Z"');
  });

  it("replaces an authored placeholder d instead of emitting two", () => {
    const html = '<path d="M0,0Z" data-kino-morph-from="M0,0 L10,0Z" data-kino-morph-to="M0,0 L10,10Z"/>';
    const out = applyPathMorphs(html, vars).html;
    expect(out.match(/\sd=/g)).toHaveLength(1);
    expect(out).toContain('d="M0 0 L10 5 Z"');
  });

  it("does not mistake data-* for the d attribute", () => {
    const html = '<path data-kino-morph-from="M0,0 L1,0Z" data-kino-morph-to="M0,0 L1,1Z" data-id="d"/>';
    const out = applyPathMorphs(html, vars).html;
    expect(out).toContain('data-kino-morph-from="M0,0 L1,0Z"');
    expect(out).toContain('data-id="d"');
  });

  it("leaves untouched markup byte-identical (no morph attribute anywhere)", () => {
    const html = '<div class="a" style="opacity:var(--progress)">hi</div>';
    expect(applyPathMorphs(html, vars).html).toBe(html);
  });

  it("reports a mismatch and keeps the authored d, so nothing ships half-resolved", () => {
    const html = '<path d="M0,0Z" data-kino-morph-from="M0,0 L1,1" data-kino-morph-to="M0,0 C1,1 2,2 3,3"/>';
    const out = applyPathMorphs(html, vars);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]).toMatch(/command 2 differs/);
    expect(out.html).toContain('d="M0,0Z"');
  });

  it("reports a lone endpoint", () => {
    const out = applyPathMorphs('<path data-kino-morph-from="M0,0 L1,1"/>', vars);
    expect(out.errors[0]).toMatch(/has no data-kino-morph-to/);
  });

  it("resolves several morphs in one page independently", () => {
    const html =
      '<path data-kino-morph-from="M0,0 L10,0Z" data-kino-morph-to="M0,0 L10,10Z"/>' +
      '<path data-kino-morph-from="M0,0 L20,0Z" data-kino-morph-to="M0,0 L20,20Z" data-kino-morph-t="0.25"/>';
    const out = applyPathMorphs(html, vars);
    expect(out.errors).toEqual([]);
    expect(out.html).toContain('d="M0 0 L10 5 Z"');
    expect(out.html).toContain('d="M0 0 L20 5 Z"');
  });
});

describe("lintPathMorphs", () => {
  it("passes a well-formed morph", () => {
    expect(
      lintPathMorphs('<path data-kino-morph-from="M0,0 L1,0Z" data-kino-morph-to="M0,0 L1,1Z" data-kino-morph-t="var(--morph)"/>'),
    ).toEqual([]);
  });

  it("costs nothing on a page with no morph", () => {
    expect(lintPathMorphs("<div class='x'></div>")).toEqual([]);
  });

  it("flags a structural mismatch at authoring time", () => {
    const found = lintPathMorphs('<path data-kino-morph-from="M0,0 L1,1" data-kino-morph-to="M0,0 L1,1 L2,2"/>');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/command count differs/);
  });

  it("flags an unparseable endpoint", () => {
    expect(lintPathMorphs('<path data-kino-morph-from="wat" data-kino-morph-to="M0,0Z"/>')[0]).toMatch(
      /unknown path command|must start with a command letter/,
    );
  });

  it("flags a malformed driver but accepts an as-yet-undeclared param", () => {
    expect(lintPathMorphs('<path data-kino-morph-from="M0,0Z" data-kino-morph-to="M1,1Z" data-kino-morph-t="var(--x"/>')[0]).toMatch(
      /unclosed/,
    );
    expect(
      lintPathMorphs('<path data-kino-morph-from="M0,0Z" data-kino-morph-to="M1,1Z" data-kino-morph-t="var(--not-yet)"/>'),
    ).toEqual([]);
  });

  it("passes every morph example printed by `kino motion`", () => {
    // The whole workstream exists because 0 of 37 authors found capabilities that already existed, so
    // the discovery surface is the product. A doc snippet the engine would reject is worse than none —
    // and the first version of that help text shipped a from/to pair with mismatched structure.
    const help = motionHelpText();
    const paths = [...help.matchAll(/data-kino-morph-(?:from|to|t)='([^']*)'/g)];
    expect(paths.length).toBeGreaterThanOrEqual(3);
    const docHtml = help.replace(/'/g, '"');
    expect(lintPathMorphs(docHtml)).toEqual([]);
    // …and the drivers it shows must actually evaluate against a real frame's variables.
    for (const m of docHtml.matchAll(/data-kino-morph-t="([^"]*)"/g)) {
      expect(() => evalMorphDriver(m[1], { "--progress": "0.5", "--morph": "0.5" })).not.toThrow();
    }
  });

  it("rides the Tier-1 HTML source lint, so a bad morph fails validate rather than mid-render", () => {
    const html = '<svg><path data-kino-morph-from="M0,0 L1,1" data-kino-morph-to="M0,0 C1,1 2,2 3,3"/></svg>';
    expect(lintMotionSource("motion/x.html", html).join(" ")).toMatch(/cannot be interpolated/);
    const ok = '<svg><path data-kino-morph-from="M0,0 L1,1" data-kino-morph-to="M0,0 L2,2"/></svg>';
    expect(lintMotionSource("motion/x.html", ok)).toEqual([]);
  });
});
