// captionAnimation in the native raster.
//
// The gap this closes: the caption raster is keyed by the active word, so an entrance spring had no
// frames to ride and every preset painted as its settled pose. The fix splits the TEMPLATE (word-
// keyed, expensive, fonts inlined) from the PIXELS (per-frame CSS vars, cheap) — so these tests
// come in two halves: the vars are the right numbers at the right times, and the markup reads them
// through fallbacks that reproduce today's settled caption when there are none.
import { describe, it, expect } from "vitest";
import {
  captionAnimStarts,
  captionAnimVars,
  captionAnimSettled,
  animatePreset,
  CAPTION_ENTRANCE_SEC,
  CAPTION_STAGGER_SEC,
} from "../src/render/textStyles.js";
import { captionMarkup } from "../src/render/native/page/compositor/textMarkup.js";
import { cacheKeyFor } from "../src/render/native/page/compositor/providers/html.js";
import type { Theme } from "../src/render/props.js";

const theme = {
  font: "Arial", bg: "#0b1020", accent: "#80e2b4", deep: "#0c8d64",
  accent2: "#d99a20", fg: "#ffffff", captionFontSize: 74, captionStroke: 9,
} as Theme;

describe("captionAnimStarts", () => {
  it("rides the VO in words mode — a word enters when it is spoken", () => {
    expect(
      captionAnimStarts({ anim: "pop", count: 3, beatStartSec: 4, wordStartsSec: [4.1, 4.6, 5.2], perWord: true }),
    ).toEqual([4.1, 4.6, 5.2]);
  });

  it("collapses to one entrance when reveal is 'all', which lays the line out at once", () => {
    expect(
      captionAnimStarts({ anim: "pop", count: 3, beatStartSec: 4, wordStartsSec: [4.1, 4.6, 5.2], perWord: false }),
    ).toEqual([4, 4, 4]);
  });

  it("staggers a phrase caption only for the presets whose identity is the stagger", () => {
    const wave = captionAnimStarts({ anim: "wave", count: 3, beatStartSec: 2, perWord: false });
    expect(wave).toEqual([2, 2 + CAPTION_STAGGER_SEC, 2 + 2 * CAPTION_STAGGER_SEC]);
    const pop = captionAnimStarts({ anim: "pop", count: 3, beatStartSec: 2, perWord: false });
    expect(pop).toEqual([2, 2, 2]);
  });
});

describe("captionAnimVars", () => {
  const starts = [1, 1.5];

  it("emits a transform and an opacity per word while an entrance is in flight", () => {
    const css = captionAnimVars({ anim: "pop", starts, tAbs: 1.05, fps: 30 });
    expect(css).toMatch(/--ka0-t:scale\(/);
    expect(css).toMatch(/--ka0-o:/);
    expect(css).toMatch(/--ka1-t:/);
  });

  it("starts at animatePreset's zero pose — one definition of 'pop', not two", () => {
    const zero = animatePreset("pop", { s: 0, frame: 0, index: 0 });
    const css = captionAnimVars({ anim: "pop", starts: [1], tAbs: 1, fps: 30 });
    expect(css).toContain(`--ka0-t:${zero.transform}`);
    expect(css).toContain(`--ka0-o:${zero.opacity}`);
  });

  it("overshoots mid-entrance — the spring the keyed raster could never show", () => {
    const scaleAt = (tAbs: number) => {
      const css = captionAnimVars({ anim: "pop", starts: [1], tAbs, fps: 30 });
      return Number(css.match(/--ka0-t:scale\(([\d.]+)\)/)![1]);
    };
    const peak = Math.max(...[0.3, 0.4, 0.5, 0.6, 0.7].map((f) => scaleAt(1 + CAPTION_ENTRANCE_SEC * f)));
    expect(peak).toBeGreaterThan(1);
  });

  it("holds a word at its pre-entrance pose until its own start", () => {
    // Word 1 starts at 1.5s; at 1.05s it has not begun, so it sits at the preset's zero pose.
    const css = captionAnimVars({ anim: "pop", starts, tAbs: 1.05, fps: 30 });
    expect(css).toMatch(/--ka1-t:scale\(0\.7\)/);
    expect(css).toMatch(/--ka1-o:0(;|$)/);
  });

  it("emits a filter only for the preset that has one", () => {
    expect(captionAnimVars({ anim: "blur-in", starts: [1], tAbs: 1.05, fps: 30 })).toMatch(/--ka0-f:blur\(/);
    expect(captionAnimVars({ anim: "pop", starts: [1], tAbs: 1.05, fps: 30 })).not.toMatch(/--ka0-f/);
  });

  it("goes empty once every entrance has landed — the whole cost story", () => {
    const late = Math.max(...starts) + CAPTION_ENTRANCE_SEC + 0.001;
    expect(captionAnimVars({ anim: "pop", starts, tAbs: late, fps: 30 })).toBe("");
    expect(captionAnimSettled("pop", starts, late)).toBe(true);
  });

  it("never settles for wave — a continuous bob is per-frame by definition", () => {
    const late = Math.max(...starts) + 60;
    expect(captionAnimSettled("wave", starts, late)).toBe(false);
    expect(captionAnimVars({ anim: "wave", starts, tAbs: late, fps: 30 })).not.toBe("");
  });

  it("moves the bob between frames while a whole-line preset has stopped moving", () => {
    const a = captionAnimVars({ anim: "wave", starts, tAbs: 6, fps: 30 });
    const b = captionAnimVars({ anim: "wave", starts, tAbs: 6.2, fps: 30 });
    expect(b).not.toBe(a);
  });
});

describe("caption markup reads the vars through settled fallbacks", () => {
  const words = [
    { word: "ship", start: 1, end: 1.4 },
    { word: "faster", start: 1.4, end: 2 },
  ];
  const base = { text: "ship faster", theme, hero: false, activeWord: 0 as number | null };

  it("is byte-identical to the pre-animation markup when no preset is set", () => {
    const plain = captionMarkup({ ...base, words, tAbs: 1.2 });
    expect(plain).not.toContain("kino-word-anim");
    expect(plain).not.toContain("--ka");
  });

  it("wraps each word once when a preset is set", () => {
    const animated = captionMarkup({ ...base, words, tAbs: 1.2, animation: "pop" });
    expect(animated.match(/kino-word-anim/g)).toHaveLength(2);
    expect(animated).toContain("transform:var(--ka0-t,none)");
    expect(animated).toContain("opacity:var(--ka1-o,1)");
  });

  it("gives every animated property a fallback equal to the settled pose", () => {
    // This is what makes a raster taken with NO vars the settled caption: none / 1 / empty.
    const animated = captionMarkup({ ...base, words, tAbs: 1.2, animation: "rise" });
    expect(animated).toContain("var(--ka0-t,none)");
    expect(animated).toContain("var(--ka0-o,1)");
    expect(animated).toContain("var(--ka0-f,)");
  });

  it("splits a phrase caption into words so a stagger has something to stagger", () => {
    const phrase = captionMarkup({ ...base, activeWord: null, animation: "wave" });
    expect(phrase.match(/kino-word-anim/g)).toHaveLength(2);
    const unanimated = captionMarkup({ ...base, activeWord: null });
    expect(unanimated).not.toContain("kino-word");
  });

  it("animates a hero caption too", () => {
    const hero = captionMarkup({ ...base, hero: true, words, tAbs: 1.2, animation: "pop" });
    expect(hero.match(/kino-word-anim/g)).toHaveLength(2);
  });
});

describe("raster identity", () => {
  // The provider composes these two: `templateKey` picks the markup, and the vars key the pixels
  // within it. Asserting the template half here keeps the split honest — a words-mode caption must
  // still build one template per word no matter how many frames its entrance takes.
  it("keys the template by the active word, not the frame", () => {
    expect(cacheKeyFor("keyed", 10, "w3")).toBe("k:w3");
    expect(cacheKeyFor("keyed", 99, "w3")).toBe("k:w3");
  });

  it("still keys a dynamic source by frame", () => {
    expect(cacheKeyFor("dynamic", 10, "w3")).toBe("f:10");
  });
});
