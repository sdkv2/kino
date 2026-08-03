import { describe, it, expect } from "vitest";
import { musicVolumeAt, musicBedLevelAt } from "../src/render/audio.js";

const opts = {
  duckSpans: [{ from: 2, to: 5 }],
  volume: 0.2,
  duck: 0.05,
  fadeOutSec: 2,
  endSec: 20,
};

describe("musicVolumeAt", () => {
  it("plays the bed level outside spans and the duck level inside", () => {
    expect(musicVolumeAt(0.5, opts)).toBeCloseTo(0.2, 5);
    expect(musicVolumeAt(3.5, opts)).toBeCloseTo(0.05, 5);
  });

  it("ramps linearly over 0.3s into and out of a span", () => {
    // Halfway through the 0.3s pre-roll: halfway between volume and duck.
    expect(musicVolumeAt(1.85, opts)).toBeCloseTo(0.125, 3);
    // Halfway through the release after to=5.
    expect(musicVolumeAt(5.15, opts)).toBeCloseTo(0.125, 3);
  });

  it("takes the most-ducked value when ramps overlap", () => {
    const o = { ...opts, duckSpans: [{ from: 2, to: 3 }, { from: 3.1, to: 4 }] };
    // In the 0.1s gap both spans' ramps apply — must stay at/near duck, never pop to full volume.
    expect(musicVolumeAt(3.05, o)).toBeLessThan(0.08);
  });

  it("fades to zero over the final fadeOutSec", () => {
    expect(musicVolumeAt(19, opts)).toBeCloseTo(0.1, 3); // halfway through the 2s fade (0.2 · 0.5)
    expect(musicVolumeAt(20, opts)).toBeCloseTo(0, 5);
    expect(musicVolumeAt(25, opts)).toBe(0);
  });

  it("handles no spans and zero fade", () => {
    expect(musicVolumeAt(1, { ...opts, duckSpans: [], fadeOutSec: 0 })).toBeCloseTo(0.2, 5);
  });

  it("ramps linearly from 0 to full volume over the head fadeInSec", () => {
    const o = { ...opts, duckSpans: [], fadeInSec: 1 };
    expect(musicVolumeAt(0, o)).toBeCloseTo(0, 5);
    expect(musicVolumeAt(0.5, o)).toBeCloseTo(0.1, 5); // halfway: 0.2 * 0.5
    expect(musicVolumeAt(1, o)).toBeCloseTo(0.2, 5); // fade complete, back to bed level
  });

  it("no head fade when fadeInSec is 0", () => {
    expect(musicVolumeAt(0, { ...opts, duckSpans: [], fadeInSec: 0 })).toBeCloseTo(0.2, 5);
  });
});

// `keyframes` set the BED LEVEL — the thing `volume` used to be a constant for. Ducking, the head
// fade and the tail fade all still apply on top, in that order.
describe("musicVolumeAt with keyframes", () => {
  const quiet = { ...opts, duckSpans: [], fadeOutSec: 0 };

  it("treats the base `volume` as the implicit t=0 keyframe, so a lone keyframe tweens from it", () => {
    const o = { ...quiet, keyframes: [{ at: 4, params: { volume: 0.6 } }] };
    expect(musicVolumeAt(0, o)).toBeCloseTo(0.2, 5); // the base, not the keyframe
    expect(musicVolumeAt(2, o)).toBeCloseTo(0.4, 5); // halfway from 0.2 to 0.6
    expect(musicVolumeAt(4, o)).toBeCloseTo(0.6, 5);
  });

  it("holds the last keyframe to the end of the timeline", () => {
    const o = { ...quiet, keyframes: [{ at: 2, params: { volume: 0.5 } }] };
    expect(musicVolumeAt(9, o)).toBeCloseTo(0.5, 5);
  });

  it("an explicit t=0 keyframe replaces the base rather than tweening from it", () => {
    const o = { ...quiet, keyframes: [{ at: 0, params: { volume: 0.8 } }, { at: 2, params: { volume: 0.8 } }] };
    expect(musicVolumeAt(0, o)).toBeCloseTo(0.8, 5);
    expect(musicVolumeAt(1, o)).toBeCloseTo(0.8, 5);
  });

  it("eases between keyframes with the named curve, not linearly", () => {
    const linear = { ...quiet, keyframes: [{ at: 0, params: { volume: 0 } }, { at: 2, params: { volume: 1 } }] };
    const eased = { ...quiet, keyframes: [{ at: 0, params: { volume: 0 } }, { at: 2, params: { volume: 1 }, ease: "easeInCubic" as const }] };
    expect(musicVolumeAt(1, linear)).toBeCloseTo(0.5, 5);
    expect(musicVolumeAt(1, eased)).toBeCloseTo(0.125, 5); // 0.5³
    // `hold` steps at the keyframe instead of lerping through the middle.
    const held = { ...quiet, keyframes: [{ at: 0, params: { volume: 0 } }, { at: 2, params: { volume: 1 }, ease: "hold" as const }] };
    expect(musicVolumeAt(1.9, held)).toBeCloseTo(0, 5);
    expect(musicVolumeAt(2, held)).toBeCloseTo(1, 5);
  });

  it("ducks relative to the KEYFRAMED level, so a VO span inside a swell doesn't step", () => {
    // Bed swells 0.2 → 0.8 over 10s; a VO span sits at 4–6s. At 3.85s we are halfway through the
    // 0.3s pre-roll ramp, and the level there must be halfway between the bed's CURRENT level and
    // duck — interpolating from the authored 0.2 would jump the bed down mid-swell.
    const o = {
      ...opts,
      duckSpans: [{ from: 4, to: 6 }],
      fadeOutSec: 0,
      keyframes: [{ at: 10, params: { volume: 0.8 } }],
    };
    const bedAt = (t: number) => 0.2 + (0.8 - 0.2) * (t / 10);
    expect(musicBedLevelAt(3.85, o)).toBeCloseTo(bedAt(3.85), 5);
    expect(musicVolumeAt(3.85, o)).toBeCloseTo(0.05 + (bedAt(3.85) - 0.05) * 0.5, 5);
    expect(musicVolumeAt(5, o)).toBeCloseTo(0.05, 5); // inside the span: plain duck level
    expect(musicVolumeAt(6.15, o)).toBeCloseTo(0.05 + (bedAt(6.15) - 0.05) * 0.5, 5);
  });

  it("a keyframe to 0 is a hard gate that ducking cannot lift back up", () => {
    // Gate closed from 4s. duck (0.05) is ABOVE the gated level, and the Math.min keeps 0 winning
    // — inside the VO span, through both ramps, everywhere past the gate.
    const o = {
      ...opts,
      duckSpans: [{ from: 5, to: 7 }],
      fadeOutSec: 0,
      keyframes: [{ at: 4, params: { volume: 0 } }],
    };
    for (const t of [4, 4.8, 5, 6, 7, 7.15, 9]) expect(musicVolumeAt(t, o)).toBeCloseTo(0, 6);
    expect(musicVolumeAt(2, o)).toBeCloseTo(0.1, 5); // still tweening down before the gate
  });

  it("keeps the head/tail fades multiplicative over the keyframed level", () => {
    const o = { ...opts, duckSpans: [], fadeInSec: 2, fadeOutSec: 2, keyframes: [{ at: 20, params: { volume: 0.4 } }] };
    // t=1: bed has tweened 0.2→0.4 by 5% (0.21) and the head fade is at 50%.
    expect(musicVolumeAt(1, o)).toBeCloseTo(0.21 * 0.5, 5);
    // t=19: bed at 0.39, tail fade at 50%.
    expect(musicVolumeAt(19, o)).toBeCloseTo(0.39 * 0.5, 5);
    expect(musicVolumeAt(20, o)).toBe(0);
  });

  it("an empty keyframe list behaves exactly like no keyframes", () => {
    expect(musicVolumeAt(1, { ...opts, keyframes: [] })).toBe(musicVolumeAt(1, opts));
    expect(musicVolumeAt(3.5, { ...opts, keyframes: [] })).toBe(musicVolumeAt(3.5, opts));
  });
});
