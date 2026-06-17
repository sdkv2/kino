import { describe, it, expect } from "vitest";
import { buildMotionVars } from "../src/render/motionVars.js";

const theme = { font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64", gold: "#d99a20", white: "#ffffff", captionFontSize: 74, captionStroke: 9 };
const dyn = { frame: 12, t: 0.4, progress: 0.5, pulse: 0.25, params: {} as Record<string, number | string> };

describe("buildMotionVars", () => {
  it("injects the full brand palette including gold (the bug: gold was missing)", () => {
    const v = buildMotionVars(theme, dyn);
    expect(v["--kino-mint"]).toBe("#80e2b4");
    expect(v["--kino-green"]).toBe("#0c8d64");
    expect(v["--kino-night"]).toBe("#0b1020");
    expect(v["--kino-white"]).toBe("#ffffff");
    expect(v["--kino-gold"]).toBe("#d99a20");
    expect(v["--kino-font"]).toBe("Arial");
  });
  it("also exposes the legacy --gold alias used by the shipped motion-flex examples", () => {
    expect(buildMotionVars(theme, dyn)["--gold"]).toBe("#d99a20");
  });
  it("sets the frame-driven vars", () => {
    const v = buildMotionVars(theme, dyn);
    expect(v["--frame"]).toBe("12");
    expect(v["--t"]).toBe("0.4000");
    expect(v["--progress"]).toBe("0.5000");
    expect(v["--pulse"]).toBe("0.2500");
  });
  it("maps each resolved param to a --<key> var, stringified", () => {
    const v = buildMotionVars(theme, { ...dyn, params: { pct: 86, label: "hi" } });
    expect(v["--pct"]).toBe("86");
    expect(v["--label"]).toBe("hi");
  });
  it("exposes the caption band bottom so authors can keep text clear of the caption", () => {
    expect(buildMotionVars(theme, { ...dyn, captionBottom: 470 })["--kino-caption-bottom"]).toBe("470px");
  });
  it("reports a zero caption band when the beat has no caption", () => {
    expect(buildMotionVars(theme, dyn)["--kino-caption-bottom"]).toBe("0px");
    expect(buildMotionVars(theme, { ...dyn, captionBottom: 0 })["--kino-caption-bottom"]).toBe("0px");
  });
});
