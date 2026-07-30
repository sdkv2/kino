import { describe, it, expect } from "vitest";
import { procLib } from "../src/render/procLib.js";
import { lintMotionJs } from "../src/render/motiongraphic.js";
import type { MotionEnv } from "../src/render/props.js";

describe("procLib.shape (d3-shape)", () => {
  it("exposes the d3-shape generators and emits path data headlessly", () => {
    const line = procLib.shape.line();
    expect(line([[0, 0], [10, 10]])).toBe("M0,0L10,10");
    const arc = procLib.shape.arc();
    const d = arc({ innerRadius: 0, outerRadius: 50, startAngle: 0, endAngle: Math.PI / 2 });
    expect(d).toMatch(/^M/);
    expect(typeof procLib.shape.curveCatmullRom).toBe("function");
  });
});

describe("procLib.color (culori)", () => {
  it("parses, interpolates in oklch, and formats hex", () => {
    const ramp = procLib.color.interpolate(["#ff0000", "#0000ff"], "oklch");
    const mid = procLib.color.formatHex(ramp(0.5));
    expect(mid).toMatch(/^#[0-9a-f]{6}$/);
    expect(mid).not.toBe("#ff0000");
    expect(procLib.color.formatHex("rebeccapurple")).toBe("#663399");
  });
});

describe("procLib noise (simplex-noise, deterministically seeded)", () => {
  it("default fields exist and stay in [-1, 1]", () => {
    for (const [x, y] of [[0.1, 0.2], [3.7, -2.2], [100.5, 42.42]]) {
      const v = procLib.noise2D(x, y);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(procLib.noise3D(0.3, 0.6, 0.9)).toBeTypeOf("number");
    expect(procLib.noise4D(0.3, 0.6, 0.9, 1.2)).toBeTypeOf("number");
  });

  it("is stable call-to-call (pure field, no hidden state)", () => {
    expect(procLib.noise2D(1.25, 3.5)).toBe(procLib.noise2D(1.25, 3.5));
    expect(procLib.noise3D(1.25, 3.5, 0.5)).toBe(procLib.noise3D(1.25, 3.5, 0.5));
  });

  it("seedNoise: same seed → identical field, different seed → different field", () => {
    const a1 = procLib.seedNoise("wave");
    const a2 = procLib.seedNoise("wave");
    const b = procLib.seedNoise("dust");
    const grid: Array<[number, number]> = [[0.2, 0.4], [1.5, 2.5], [-3.3, 7.7]];
    for (const [x, y] of grid) expect(a1.noise2D(x, y)).toBe(a2.noise2D(x, y));
    expect(grid.some(([x, y]) => a1.noise2D(x, y) !== b.noise2D(x, y))).toBe(true);
    expect(procLib.seedNoise(7).noise2D(0.5, 0.5)).toBe(procLib.seedNoise(7).noise2D(0.5, 0.5));
  });
});

describe("procLib hardening", () => {
  it("is frozen so a proc can't mutate shared state across beats", () => {
    expect(Object.isFrozen(procLib)).toBe(true);
    expect(() => {
      (procLib as unknown as Record<string, unknown>).shape = null;
    }).toThrow();
  });
});

// The provider evaluates `new Function("env", proc)` — mirror that exact contract here with a
// chart-flavored source that leans on all three libraries, and confirm the lint accepts it.
describe("Tier-2 render(env) with env.lib", () => {
  const src = `
    const pts = [12, 30, 22, 44, 38, 52].map((v, i) => [i * 100, 200 - v - 20 * env.lib.noise2D(i * 0.7, 1.5)]);
    const path = env.lib.shape.line().curve(env.lib.shape.curveCatmullRom)(pts);
    const tint = env.lib.color.formatHex(env.lib.color.interpolate([env.palette.mint, env.palette.gold], "oklch")(env.progress));
    return '<svg viewBox="0 0 500 200"><path d="' + path + '" stroke="' + tint + '" fill="none"/></svg>';
  `;

  it("passes the determinism/safety lint", () => {
    expect(lintMotionJs(src)).toEqual([]);
  });

  it("renders markup through the same new Function seam the provider uses", () => {
    const fn = new Function("env", src) as (env: Partial<MotionEnv>) => string;
    const env = { progress: 0.5, palette: { mint: "#7de2c3", green: "#0f5132", night: "#0b1220", white: "#ffffff", gold: "#d4a017", font: "Inter" }, lib: procLib };
    const html = fn(env);
    expect(html).toContain('<path d="M');
    expect(html).toMatch(/stroke="#[0-9a-f]{6}"/);
    expect(fn(env)).toBe(html); // same env → same markup, frame after frame
  });
});
