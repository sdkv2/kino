import { describe, it, expect } from "vitest";
import { evalDriveExpr, validateDriveExpr } from "../src/render/driveExpr.js";

const ctx = { t: 1, p: 0.5, dur: 2, seed: 3 };

describe("driveExpr", () => {
  it("evaluates arithmetic and vars", () => {
    expect(evalDriveExpr("t * 2 + 1", ctx)).toBe(3);
    expect(evalDriveExpr("sin(pi/2)", ctx)).toBeCloseTo(1, 5);
  });

  it("wiggle is deterministic per seed", () => {
    const a = evalDriveExpr("wiggle(4, 2)", ctx);
    const b = evalDriveExpr("wiggle(4, 2)", ctx);
    expect(a).toBe(b);
    expect(Math.abs(a)).toBeLessThanOrEqual(2);
  });

  it("rejects unknown identifiers", () => {
    expect(validateDriveExpr("evil()")).toMatch(/unknown/);
  });
});
