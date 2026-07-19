import { describe, it, expect } from "vitest";
import { musicVolumeAt } from "../src/render/audio.js";

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
});
