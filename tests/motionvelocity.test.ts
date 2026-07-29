import { describe, it, expect } from "vitest";
import {
  annotateVelocityTargets,
  hasVelocityTargets,
  velocityRestVars,
  velocityVarDecls,
  VEL_EPSILON,
  writeVelocityVars,
} from "../src/render/motionVelocity.js";
import { buildMotionVars } from "../src/render/motionVars.js";

const theme = {
  font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64",
  gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9,
};

/** Parse a decl string back into a map so assertions read as values, not substrings. */
const decls = (s: string): Record<string, string> =>
  Object.fromEntries(s.split(";").filter(Boolean).map((d) => {
    const i = d.indexOf(":");
    return [d.slice(0, i), d.slice(i + 1)];
  }));

describe("hasVelocityTargets", () => {
  it("gates the whole feature on the opt-in marker", () => {
    expect(hasVelocityTargets("<span data-kino-vel>S</span>")).toBe(true);
    expect(hasVelocityTargets('<span class="letter">S</span>')).toBe(false);
  });
});

describe("annotateVelocityTargets", () => {
  it("numbers the opted-in elements in source order", () => {
    const out = annotateVelocityTargets("<span data-kino-vel>S</span><b data-kino-vel>M</b>");
    expect(out.count).toBe(2);
    expect(out.html).toBe('<span data-kino-vel="0">S</span><b data-kino-vel="1">M</b>');
  });

  it("renumbers an already-valued attribute (the reference frame gets the same indices)", () => {
    const once = annotateVelocityTargets('<i data-kino-vel="7">a</i><i data-kino-vel>b</i>');
    expect(once.html).toBe('<i data-kino-vel="0">a</i><i data-kino-vel="1">b</i>');
    expect(annotateVelocityTargets(once.html).html).toBe(once.html);
  });

  it("leaves a page with no marker byte-identical", () => {
    const html = '<div class="a" data-kino-velocity="x">hi</div>';
    const out = annotateVelocityTargets(html);
    expect(out.count).toBe(0);
    expect(out.html).toBe(html);
  });
});

describe("velocityVarDecls", () => {
  it("reports magnitude, unsigned per-axis speed, signed direction and an angle", () => {
    const d = decls(velocityVarDecls({ cx: 30, cy: 40 }, { cx: 0, cy: 0 }, false));
    expect(d["--kino-vel"]).toBe("50");
    expect(d["--kino-vel-x"]).toBe("30");
    expect(d["--kino-vel-y"]).toBe("40");
    expect(d["--kino-vel-dx"]).toBe("30");
    expect(d["--kino-vel-dy"]).toBe("40");
    expect(d["--kino-vel-angle"]).toBe("53.13deg");
  });

  it("keeps per-axis speeds unsigned so blur() stays a valid declaration", () => {
    // A negative length invalidates the whole declaration and takes the element's paint with it —
    // the exact way authored effects went invisible in the review this feature came from.
    const d = decls(velocityVarDecls({ cx: 0, cy: 0 }, { cx: 12, cy: 5 }, false));
    expect(d["--kino-vel-x"]).toBe("12");
    expect(d["--kino-vel-y"]).toBe("5");
    expect(d["--kino-vel-dx"]).toBe("-12");
    expect(d["--kino-vel-dy"]).toBe("-5");
  });

  it("flips the sign on the opening frame, where the reference is the frame AFTER", () => {
    const back = decls(velocityVarDecls({ cx: 10, cy: 0 }, { cx: 0, cy: 0 }, false));
    const fwd = decls(velocityVarDecls({ cx: 0, cy: 0 }, { cx: 10, cy: 0 }, true));
    // Same travel, same direction: both describe motion toward +x.
    expect(fwd["--kino-vel-dx"]).toBe(back["--kino-vel-dx"]);
    expect(fwd["--kino-vel"]).toBe(back["--kino-vel"]);
  });

  it("reads exactly zero for a parked element — the smear appears only while it moves", () => {
    const d = decls(velocityVarDecls({ cx: 100, cy: 100 }, { cx: 100, cy: 100 }, false));
    expect(Object.values(d)).toEqual(["0", "0", "0", "0", "0", "0deg"]);
  });

  it("clamps sub-pixel drift to zero, so a static page's markup stays stable", () => {
    const tiny = VEL_EPSILON / 4;
    const d = decls(velocityVarDecls({ cx: tiny, cy: 0 }, { cx: 0, cy: 0 }, false));
    expect(d["--kino-vel"]).toBe("0");
    expect(d["--kino-vel-angle"]).toBe("0deg");
  });

  it("reports zero when either box is missing rather than throwing", () => {
    expect(decls(velocityVarDecls(undefined, { cx: 1, cy: 1 }, false))["--kino-vel"]).toBe("0");
    expect(decls(velocityVarDecls({ cx: 1, cy: 1 }, undefined, false))["--kino-vel"]).toBe("0");
  });

  it("rounds, so the same travel always prints the same bytes", () => {
    const a = velocityVarDecls({ cx: 1 / 3, cy: 0 }, { cx: 0, cy: 0 }, false);
    expect(a).toBe(velocityVarDecls({ cx: 1 / 3, cy: 0 }, { cx: 0, cy: 0 }, false));
    expect(decls(a)["--kino-vel"]).toBe("0.333");
  });
});

describe("writeVelocityVars", () => {
  it("writes each element's own values, keyed by index", () => {
    const html = '<span data-kino-vel="0">S</span><span data-kino-vel="1">M</span>';
    const out = writeVelocityVars(html, ["--kino-vel:4", "--kino-vel:9"]);
    expect(out).toBe('<span data-kino-vel="0" style="--kino-vel:4">S</span><span data-kino-vel="1" style="--kino-vel:9">M</span>');
  });

  it("merges into an existing style attribute instead of dropping it", () => {
    const out = writeVelocityVars('<b data-kino-vel="0" style="color:red;">x</b>', ["--kino-vel:2"]);
    expect(out).toBe('<b data-kino-vel="0" style="color:red;--kino-vel:2">x</b>');
  });

  it("ignores an element with no measurement and anything that never opted in", () => {
    const html = '<span data-kino-vel="0">S</span><span data-kino-vel="1">M</span><i>plain</i>';
    expect(writeVelocityVars(html, ["--kino-vel:4"])).toBe(
      '<span data-kino-vel="0" style="--kino-vel:4">S</span><span data-kino-vel="1">M</span><i>plain</i>',
    );
  });

  it("does not confuse a data-style attribute for style", () => {
    const out = writeVelocityVars('<b data-kino-vel="0" data-style="loud">x</b>', ["--kino-vel:2"]);
    expect(out).toBe('<b data-kino-vel="0" data-style="loud" style="--kino-vel:2">x</b>');
  });
});

describe("resting values on the page root", () => {
  it("publishes every velocity property as 0, so var() on a non-opted element is never undefined", () => {
    const vars = buildMotionVars(theme, { frame: 0, t: 0, progress: 0, pulse: 0, params: {} });
    for (const [k, v] of Object.entries(velocityRestVars())) expect(vars[k]).toBe(v);
    expect(vars["--kino-vel-y"]).toBe("0");
  });
});
