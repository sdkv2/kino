// Two feedback gaps that cost an agent whole turns, pinned:
//
//  1. A typo inside an overlay tween's `params` used to VALIDATE and then do nothing — the render
//     was clean, the motion was absent, and there was no error to correct against.
//  2. `unrecognized key 'duration'` never said `dur`, even though the validator holds the key set.
//
// The suggester must also stay quiet when it has nothing useful to say: a confident wrong guess is
// worse than none, because it sends the author to rename a key that was never the problem.
import { describe, it, expect } from "vitest";
import { parseSpec, suggestKey } from "../src/spec/schema.js";

const spec = (seg: Record<string, unknown>, top: Record<string, unknown> = {}) => ({
  title: "probe",
  format: ["9:16"],
  segments: [{ text: "hi", dur: 2, ...seg }],
  ...top,
});

describe("overlay tween params are closed", () => {
  it("rejects a typo'd channel instead of silently ignoring it", () => {
    expect(() => parseSpec(spec({ captionKeyframes: [{ at: 0, params: { opacty: 1 } }] }))).toThrow(
      /unrecognized tween param 'opacty' — did you mean 'opacity'\?/,
    );
  });

  it("lists the valid channels in the error", () => {
    expect(() => parseSpec(spec({ captionKeyframes: [{ at: 0, params: { nope: 1 } }] }))).toThrow(
      /valid: x, y, scale, opacity, rotate, scaleX, scaleY, anchorX, anchorY/,
    );
  });

  it("accepts every channel tweenAt actually reads", () => {
    const params = { x: 1, y: 2, scale: 1.1, opacity: 0.5, rotate: 4, scaleX: 1.2, scaleY: 0.9, anchorX: 0.2, anchorY: 0.8 };
    expect(() => parseSpec(spec({ captionKeyframes: [{ at: 0, params }] }))).not.toThrow();
  });

  it("guards kicker and zoom tracks too", () => {
    for (const track of ["kickerKeyframes", "zoomKeyframes"]) {
      expect(() =>
        parseSpec(spec({ kind: "video", source: "a.mp4", [track]: [{ at: 0, params: { opacty: 1 } }] })),
      ).toThrow(/unrecognized tween param/);
    }
  });

  it("leaves background param bags open — arbitrary author names are the point there", () => {
    expect(() =>
      parseSpec(spec({}, { background: "mesh", backgroundKeyframes: [{ at: 0, params: { myCustomKnob: 3 } }] })),
    ).not.toThrow();
  });
});

describe("unrecognized keys suggest the near miss", () => {
  it("maps a longer spelling back to the real key", () => {
    expect(() => parseSpec(spec({ duration: 2 }))).toThrow(/unrecognized key 'duration' — did you mean 'dur'\?/);
  });

  it("catches a single-character slip", () => {
    expect(() => parseSpec(spec({ emphassis: [] }))).toThrow(/did you mean 'emphasis'\?/);
  });

  it("prefers a near-match over the typo's own prefix", () => {
    expect(() => parseSpec(spec({ captionKeyfrmes: [] }))).toThrow(/did you mean 'captionKeyframes'\?/);
  });

  it("suggests top-level keys for a top-level typo", () => {
    expect(() => parseSpec({ ...spec({}), segmets: [] })).toThrow(/did you mean 'segments'\?/);
  });

  it("says nothing when nothing is close", () => {
    expect(() => parseSpec(spec({ wobblegoblin: 1 }))).toThrow(/unrecognized key 'wobblegoblin'$/m);
  });
});

describe("suggestKey", () => {
  const keys = ["dur", "text", "caption", "captionKeyframes", "emphasis", "segments"];

  it("returns an empty string rather than a bad guess", () => {
    expect(suggestKey("wobblegoblin", keys)).toBe("");
    expect(suggestKey("xyz", keys)).toBe("");
  });

  it("never suggests the key that was already correct", () => {
    expect(suggestKey("dur", keys)).toBe("");
  });

  it("treats a case-only difference as the answer", () => {
    expect(suggestKey("Segments", keys)).toBe(" — did you mean 'segments'?");
  });

  it("scales tolerance with word length — short keys demand a closer match", () => {
    // 2 edits is a typo in a long key, but a different word entirely in a 3-letter one.
    expect(suggestKey("captionKeyfrmes", keys)).toBe(" — did you mean 'captionKeyframes'?");
    expect(suggestKey("abc", keys)).toBe("");
  });
});
