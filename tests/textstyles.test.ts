import { describe, it, expect } from "vitest";
import {
  wordStyle, lineBoxStyle, animatePreset, composeFilters, resolveCaptionLook, resolveTexts,
  TEXT_POSITIONS, TEXT_SIZES,
} from "../src/render/textStyles.js";

const t = { night: "#0b1020", mint: "#80e2b4", green: "#0c8d64", white: "#ffffff", captionStroke: 9 };

describe("wordStyle", () => {
  it("stroke reproduces the legacy caption ink exactly", () => {
    expect(wordStyle("stroke", t)).toEqual({
      color: "#ffffff",
      fontWeight: 900,
      WebkitTextStroke: "9px #000",
      paintOrder: "stroke fill",
      textShadow: "0 6px 18px rgba(0,0,0,.45)",
    });
  });
  it("stroke honours highlight (mint ink), emph (glow), and a shadow override", () => {
    expect(wordStyle("stroke", t, { highlight: true }).color).toBe("#80e2b4");
    expect(wordStyle("stroke", t, { emph: true }).textShadow).toBe("0 0 26px #80e2b4");
    expect(wordStyle("stroke", t, { shadow: "0 6px 20px rgba(0,0,0,.45)" }).textShadow).toBe("0 6px 20px rgba(0,0,0,.45)");
  });
  it("highlight boxes the highlighted word (night ink on mint), leaves others unboxed", () => {
    const on = wordStyle("highlight", t, { highlight: true });
    expect(on.backgroundColor).toBe("#80e2b4");
    expect(on.color).toBe("#0b1020");
    expect(on.borderRadius).toBe(14);
    const off = wordStyle("highlight", t);
    expect(off.backgroundColor).toBeUndefined();
    expect(off.color).toBe("#ffffff");
    expect(off.WebkitTextStroke).toBeUndefined();
  });
  it("highlight keeps layout identical for active and inactive words (no wrap reflow)", () => {
    // The box must be paint-only: padding differences move the flex wrap point and make
    // words jump between rows as the highlight travels.
    const on = wordStyle("highlight", t, { highlight: true });
    const off = wordStyle("highlight", t);
    expect(off.padding).toBe(on.padding);
    expect(off.borderRadius).toBe(on.borderRadius);
    expect(off.fontWeight).toBe(on.fontWeight);
  });
  it("gradient clips a mint→green fill to the text and drops the stroke", () => {
    const s = wordStyle("gradient", t);
    expect(s.backgroundImage).toBe("linear-gradient(100deg, #80e2b4, #0c8d64)");
    expect(s.WebkitBackgroundClip).toBe("text");
    expect(s.WebkitTextFillColor).toBe("transparent");
    expect(s.WebkitTextStroke).toBeUndefined();
    expect(s.filter).toBe("drop-shadow(0 6px 14px rgba(0,0,0,.5))");
    expect(wordStyle("gradient", t, { emph: true }).filter).toBe("drop-shadow(0 0 18px #80e2b4)");
  });
  it("minimal is 700-weight, strokeless", () => {
    const s = wordStyle("minimal", t);
    expect(s.fontWeight).toBe(700);
    expect(s.WebkitTextStroke).toBeUndefined();
    expect(wordStyle("minimal", t, { highlight: true }).color).toBe("#80e2b4");
  });
});

describe("lineBoxStyle", () => {
  it("highlight gets an opaque night line box", () => {
    expect(lineBoxStyle("highlight", t)).toEqual({ display: "inline-block", backgroundColor: "#0b1020", padding: "12px 32px", borderRadius: 30 });
  });
  it("other styles box only when a backplate colour is supplied (legacy plateStyle)", () => {
    expect(lineBoxStyle("stroke", t)).toEqual({});
    expect(lineBoxStyle("stroke", t, "#0b1020d1")).toEqual({ display: "inline-block", backgroundColor: "#0b1020d1", padding: "12px 32px", borderRadius: 30 });
  });
});

describe("animatePreset", () => {
  it("pop scales 0.7→1 with the spring and fades in over its first half", () => {
    expect(animatePreset("pop", { s: 0, frame: 0, index: 0 })).toEqual({ transform: "scale(0.7)", opacity: 0 });
    expect(animatePreset("pop", { s: 1, frame: 10, index: 0 })).toEqual({ transform: "scale(1)", opacity: 1 });
  });
  it("rise translates 44px→0 (legacy hero formula)", () => {
    expect(animatePreset("rise", { s: 0, frame: 0, index: 0 }).transform).toBe("translateY(44px)");
    expect(animatePreset("rise", { s: 1, frame: 10, index: 0 }).transform).toBe("translateY(0px)");
  });
  it("typewriter and none reveal instantly at frame 0, hidden before", () => {
    for (const anim of ["typewriter", "none"] as const) {
      expect(animatePreset(anim, { s: 0, frame: -1, index: 0 }).opacity).toBe(0);
      expect(animatePreset(anim, { s: 0, frame: 0, index: 0 }).opacity).toBe(1);
      expect(animatePreset(anim, { s: 0, frame: 0, index: 0 }).transform).toBe("none");
    }
  });
  it("blur-in sharpens 12px→0 with the spring", () => {
    expect(animatePreset("blur-in", { s: 0, frame: 0, index: 0 }).filter).toBe("blur(12px)");
    expect(animatePreset("blur-in", { s: 1, frame: 10, index: 0 }).filter).toBe("blur(0px)");
    expect(animatePreset("blur-in", { s: 0, frame: 0, index: 0 }).transform).toBe("none");
  });
  it("wave bobs settled words on a per-index phase", () => {
    const a = animatePreset("wave", { s: 1, frame: 30, index: 0 });
    const b = animatePreset("wave", { s: 1, frame: 30, index: 2 });
    expect(a.transform).toContain("translateY(");
    expect(a.transform).not.toBe(b.transform); // phase offset by index
    expect(animatePreset("wave", { s: 0, frame: 0, index: 0 }).opacity).toBe(0);
  });
});

describe("composeFilters", () => {
  it("joins real filters, drops none/undefined, and returns undefined when empty", () => {
    expect(composeFilters("drop-shadow(0 0 2px red)", "blur(3px)")).toBe("drop-shadow(0 0 2px red) blur(3px)");
    expect(composeFilters(undefined, "none")).toBeUndefined();
  });
});

describe("resolveCaptionLook", () => {
  const brand = { style: "minimal", animation: "rise" } as const;
  it("layers segment over spec over brand over defaults", () => {
    expect(resolveCaptionLook({}, {}, undefined)).toEqual({ style: "stroke", animation: undefined });
    expect(resolveCaptionLook({}, {}, brand)).toEqual({ style: "minimal", animation: "rise" });
    expect(resolveCaptionLook({}, { captionStyle: "gradient", captionAnimation: "wave" }, brand)).toEqual({ style: "gradient", animation: "wave" });
    expect(resolveCaptionLook({ captionStyle: "highlight", captionAnimation: "pop" }, { captionStyle: "gradient" }, brand)).toEqual({ style: "highlight", animation: "pop" });
  });
});

describe("resolveTexts", () => {
  const fallback = { style: "stroke", animation: undefined } as const;
  it("returns undefined for missing/empty input", () => {
    expect(resolveTexts(undefined, 0, 5, 74, fallback)).toBeUndefined();
    expect(resolveTexts([], 0, 5, 74, fallback)).toBeUndefined();
  });
  it("maps slots, sizes, and defaults style/animation from the fallback", () => {
    const [r] = resolveTexts([{ text: "3× faster", at: 1, position: "top", size: "big", style: "gradient", animation: "blur-in" }], 10, 15, 74, fallback)!;
    expect(r).toEqual({ text: "3× faster", fromSec: 11, durSec: 4, x: 50, y: 16, sizePx: 111, style: "gradient", animation: "blur-in" });
    const [d] = resolveTexts([{ text: "x", at: 0, position: "center", size: "medium" }], 0, 2, 74, { style: "minimal", animation: "wave" })!;
    expect(d.style).toBe("minimal");
    expect(d.animation).toBe("wave");
    expect(d.sizePx).toBe(74);
    expect(d).toMatchObject(TEXT_POSITIONS.center);
  });
  it("defaults animation to pop when the fallback has none (surface-native doesn't exist for overlays)", () => {
    const [r] = resolveTexts([{ text: "x", at: 0, position: "center", size: "small" }], 0, 2, 74, fallback)!;
    expect(r.animation).toBe("pop");
    expect(r.sizePx).toBe(Math.round(74 * TEXT_SIZES.small));
  });
  it("clamps dur to the segment end and drops entries that start after it", () => {
    const [r] = resolveTexts([{ text: "x", at: 1, dur: 99, position: "center", size: "medium" }], 0, 3, 74, fallback)!;
    expect(r.durSec).toBe(2);
    expect(resolveTexts([{ text: "x", at: 5, position: "center", size: "medium" }], 0, 3, 74, fallback)).toBeUndefined();
  });
});
