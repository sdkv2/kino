// `spec.data` — the shared-constants block.
//
// The problem it solves is drift, not typing: a figure quoted on eight fabricated surfaces has to
// AGREE on all eight, and per-beat params put eight copies of it in eight files where nothing
// checks them against each other. So the tests that matter are the ones about IDENTITY (every beat
// sees the same value) and about the names the engine already owns.
import { describe, it, expect } from "vitest";
import { buildMotionVars, motionFrameState, validateSpecData, RESERVED_MOTION_VARS } from "../src/render/motionVars.js";
import type { Theme } from "../src/render/props.js";

const theme = {
  font: "Arial", bg: "#0b1020", accent: "#80e2b4", deep: "#0c8d64",
  accent2: "#d99a20", fg: "#ffffff", captionFontSize: 74, captionStroke: 9,
} as Theme;

const dyn = (over: Record<string, unknown> = {}) => ({
  frame: 0, t: 0, progress: 0, pulse: 0, params: {}, ...over,
});

describe("data reaches a motion host as CSS variables", () => {
  it("emits every key as --<key>", () => {
    const vars = buildMotionVars(theme, dyn({ data: { p95: "68ms", runs: 300 } }));
    expect(vars["--p95"]).toBe("68ms");
    expect(vars["--runs"]).toBe("300");
  });

  it("lets a beat's own params override a shared key", () => {
    const vars = buildMotionVars(theme, dyn({ data: { p95: "68ms" }, params: { p95: "50ms" } }));
    expect(vars["--p95"]).toBe("50ms");
  });

  it("changes nothing when the spec declares none", () => {
    expect(buildMotionVars(theme, dyn())).toEqual(buildMotionVars(theme, dyn({ data: {} })));
  });

  it("never shadows the frame clock or the palette", () => {
    // Belt to validateSpecData's braces: even if a reserved key reached here, the runtime's own
    // values are written after nothing that could displace them.
    const vars = buildMotionVars(theme, dyn({ data: { runs: 300 } }));
    expect(vars["--progress"]).toBe("0.000000");
    expect(vars["--kino-accent"]).toBe(theme.accent);
  });
});

describe("data reaches Tier 2 as env.data", () => {
  const state = (specData?: Record<string, string | number>) =>
    motionFrameState(
      { params: {}, keyframes: [], words: [] },
      { local: 0, fps: 30, durationFrames: 60, theme, width: 1080, height: 1920, specData },
    );

  it("carries the block verbatim", () => {
    expect(state({ p95: "68ms", runs: 300 }).env.data).toEqual({ p95: "68ms", runs: 300 });
  });

  it("is an empty object, not undefined, when the spec declares none", () => {
    expect(state().env.data).toEqual({});
  });

  it("is the SAME values on every beat — the whole point", () => {
    const shared = { p95: "68ms" };
    const a = motionFrameState(
      { params: {}, keyframes: [], words: [] },
      { local: 0, fps: 30, durationFrames: 60, theme, width: 1080, height: 1920, specData: shared },
    );
    const b = motionFrameState(
      { params: { unrelated: 3 }, keyframes: [], words: [] },
      { local: 41, fps: 30, durationFrames: 90, theme, width: 1080, height: 1920, specData: shared },
    );
    expect(b.env.data).toEqual(a.env.data);
    expect(b.vars["--p95"]).toBe(a.vars["--p95"]);
  });
});

describe("validateSpecData", () => {
  it("accepts strings and finite numbers", () => {
    expect(validateSpecData({ p95: "68ms", pct: 4.6, label: "19/412" })).toEqual([]);
  });

  it("accepts an absent block", () => {
    expect(validateSpecData(undefined)).toEqual([]);
  });

  it("rejects a name that is not a usable CSS variable", () => {
    expect(validateSpecData({ "2fast": 1 })[0]).toMatch(/not a usable name/);
    expect(validateSpecData({ "has space": 1 })[0]).toMatch(/not a usable name/);
  });

  it("reserves the engine's own namespace", () => {
    expect(validateSpecData({ "kino-accent": "#fff" })[0]).toMatch(/reserved/);
  });

  it("reserves every variable the motion runtime writes each frame", () => {
    for (const name of RESERVED_MOTION_VARS) {
      expect(validateSpecData({ [name]: 1 })[0]).toMatch(/reserved/);
    }
  });

  it("rejects a value that is neither a string nor a finite number", () => {
    expect(validateSpecData({ x: NaN })[0]).toMatch(/string or a finite number/);
    expect(validateSpecData({ x: { nested: 1 } })[0]).toMatch(/string or a finite number/);
  });

  it("rejects a block that is not an object", () => {
    expect(validateSpecData([1, 2])).toEqual(["data must be an object"]);
  });
});
