import { describe, it, expect } from "vitest";
import { detectBeatGrid, pickLoudestGridStart, solveCutDurations } from "../src/media/beats.js";

const SR = 16000;

// Synthetic kick track: decaying 60 Hz sine bursts on a fixed beat grid, optional hi-hat
// noise between beats, optional broadband noise floor. amp scales the kicks.
function kickTrack(
  totalSec: number,
  bpm: number,
  opts: { phaseSec?: number; amp?: number; hats?: boolean; noise?: number; from?: number; to?: number } = {},
): Float32Array {
  const { phaseSec = 0, amp = 0.8, hats = false, noise = 0, from = 0, to = totalSec } = opts;
  const out = new Float32Array(Math.round(totalSec * SR));
  const period = 60 / bpm;
  // deterministic pseudo-noise (no Math.random in tests)
  const rand = (i: number) => {
    const x = Math.sin(i * 12.9898) * 43758.5453;
    return (x - Math.floor(x)) * 2 - 1;
  };
  for (let t = phaseSec; t < totalSec; t += period) {
    if (t < from || t > to) continue;
    const start = Math.round(t * SR);
    const len = Math.round(0.09 * SR); // 90 ms kick
    for (let i = 0; i < len && start + i < out.length; i++) {
      const env = Math.exp(-i / (0.025 * SR));
      out[start + i] += amp * env * Math.sin((2 * Math.PI * 60 * i) / SR);
    }
    if (hats) {
      const h = Math.round((t + period / 2) * SR);
      for (let i = 0; i < 400 && h + i < out.length; i++) {
        out[h + i] += 0.15 * Math.exp(-i / 120) * rand(h + i);
      }
    }
  }
  if (noise > 0) for (let i = 0; i < out.length; i++) out[i] += noise * rand(i);
  return out;
}

describe("detectBeatGrid", () => {
  it("finds the tempo and phase of a 128 bpm kick track", () => {
    const g = detectBeatGrid(kickTrack(20, 128), SR);
    expect(g).not.toBeNull();
    expect(g!.bpm).toBeGreaterThan(126.5);
    expect(g!.bpm).toBeLessThan(129.5);
    // phase is the first grid beat — some multiple of the period from 0
    const period = 60 / 128;
    const rel = ((g!.phaseSec % period) + period) % period;
    const err = Math.min(rel, period - rel);
    expect(err).toBeLessThan(0.02);
    expect(g!.strength).toBeGreaterThan(0.7);
  });

  it("recovers a non-zero phase offset", () => {
    const g = detectBeatGrid(kickTrack(20, 95, { phaseSec: 0.21 }), SR);
    expect(g).not.toBeNull();
    expect(g!.bpm).toBeGreaterThan(93.5);
    expect(g!.bpm).toBeLessThan(96.5);
    const period = 60 / 95;
    const rel = (((g!.phaseSec - 0.21) % period) + period) % period;
    const err = Math.min(rel, period - rel);
    expect(err).toBeLessThan(0.025);
  });

  it("survives hats and a noise floor", () => {
    const g = detectBeatGrid(kickTrack(20, 124, { hats: true, noise: 0.05 }), SR);
    expect(g).not.toBeNull();
    expect(g!.bpm).toBeGreaterThan(122);
    expect(g!.bpm).toBeLessThan(126);
    expect(g!.strength).toBeGreaterThan(0.6);
  });

  it("reports weak strength on beatless audio", () => {
    const flat = new Float32Array(20 * SR);
    for (let i = 0; i < flat.length; i++) flat[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / SR);
    const g = detectBeatGrid(flat, SR);
    expect(g === null || g.strength < 0.5).toBe(true);
  });

  it("fits the grid inside the requested window (local phase, not global)", () => {
    // kicks only exist from 5 s on; a window starting at 5 s must anchor there
    const g = detectBeatGrid(kickTrack(25, 120, { from: 5 }), SR, { windowStartSec: 5, windowEndSec: 24 });
    expect(g).not.toBeNull();
    expect(g!.phaseSec).toBeGreaterThanOrEqual(4.9);
    const period = 60 / 120;
    const rel = (((g!.phaseSec - 5) % period) + period) % period;
    const err = Math.min(rel, period - rel);
    expect(err).toBeLessThan(0.025);
  });
});

describe("pickLoudestGridStart", () => {
  it("returns an on-grid start inside the loud region", () => {
    // quiet kicks for 15 s, loud kicks after — the pick should land in the loud half
    const a = kickTrack(40, 128, { amp: 0.15, to: 15 });
    const b = kickTrack(40, 128, { amp: 0.9, from: 15 });
    const mix = new Float32Array(a.length);
    for (let i = 0; i < mix.length; i++) mix[i] = a[i] + b[i];
    const g = detectBeatGrid(mix, SR)!;
    const start = pickLoudestGridStart(mix, SR, g, 18);
    expect(start).toBeGreaterThanOrEqual(14);
    // on-grid: distance to the grid is < 15 ms
    const rel = (((start - g.phaseSec) % g.periodSec) + g.periodSec) % g.periodSec;
    const err = Math.min(rel, g.periodSec - rel);
    expect(err).toBeLessThan(0.015);
    // window must fit inside the track
    expect(start + 18).toBeLessThanOrEqual(40.01);
  });
});

describe("computeMarkers grid block", () => {
  it("attaches the detected beat grid to the markers", async () => {
    const { computeMarkers } = await import("../src/media/markers.js");
    const m = computeMarkers(kickTrack(20, 128), SR);
    expect(m.grid).not.toBeNull();
    expect(m.grid!.bpm).toBeGreaterThan(126.5);
    expect(m.grid!.bpm).toBeLessThan(129.5);
  });

  it("reports a null grid for beatless audio", async () => {
    const { computeMarkers } = await import("../src/media/markers.js");
    const flat = new Float32Array(20 * SR);
    for (let i = 0; i < flat.length; i++) flat[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / SR);
    const m = computeMarkers(flat, SR);
    expect(m.grid === null || m.grid.strength < 0.5).toBe(true);
  });
});

describe("solveCutDurations", () => {
  const GAP = 0.32;

  it("locks uniform editable beats to the bar grid, including the end", () => {
    const r = solveCutDurations({
      segments: [
        { durSec: 1.5, editable: true },
        { durSec: 1.5, editable: true },
        { durSec: 1.5, editable: true },
      ],
      gapSec: GAP,
      periodSec: 0.4685,
      phaseSec: 0,
      grainBeats: 4,
    });
    const bar = 4 * 0.4685;
    expect(r.durs[0]).toBeCloseTo(bar - GAP, 3);
    expect(r.durs[1]).toBeCloseTo(bar - GAP, 3);
    // end quantized: last beat ends on a grid line
    const end = bar * 2 + r.durs[2];
    const rel = ((end % bar) + bar) % bar;
    expect(Math.min(rel, bar - rel)).toBeLessThan(0.002);
    expect(r.cuts.every((c) => c.onGrid)).toBe(true);
  });

  it("leaves VO beats alone and re-anchors after them", () => {
    const r = solveCutDurations({
      segments: [
        { durSec: 1.5, editable: true },
        { durSec: 2.0, editable: false },
        { durSec: 1.5, editable: true },
      ],
      gapSec: GAP,
      periodSec: 0.4685,
      phaseSec: 0,
      grainBeats: 4,
    });
    const bar = 4 * 0.4685;
    expect(r.durs[0]).toBeCloseTo(bar - GAP, 3);
    expect(r.durs[1]).toBe(2.0); // untouched
    const cut2 = r.cuts.find((c) => c.index === 2)!;
    expect(cut2.onGrid).toBe(false); // VO beat pushed it off grid
    // the end re-anchors: t2 = bar + 2.0 + GAP; end = t2 + durs[2] must be on grid
    const t2 = bar + 2.0 + GAP;
    const end = t2 + r.durs[2];
    const rel = ((end % bar) + bar) % bar;
    expect(Math.min(rel, bar - rel)).toBeLessThan(0.002);
  });

  it("clamps to the minimum duration by taking the next grid line up", () => {
    const r = solveCutDurations({
      segments: [
        { durSec: 0.5, editable: true },
        { durSec: 1.5, editable: true },
      ],
      gapSec: GAP,
      periodSec: 0.4685,
      phaseSec: 0,
      grainBeats: 4,
      minDurSec: 0.6,
    });
    const bar = 4 * 0.4685;
    // nearest grid to 0.82 is 0 (dur would be negative) — must take the next line up
    expect(r.durs[0]).toBeCloseTo(bar - GAP, 3);
  });

  it("honours a non-zero grid phase", () => {
    const r = solveCutDurations({
      segments: [
        { durSec: 1.5, editable: true },
        { durSec: 1.5, editable: true },
      ],
      gapSec: GAP,
      periodSec: 0.5,
      phaseSec: 0.2,
      grainBeats: 4,
    });
    // first cut = 0.2 + k·2.0 nearest to 1.82 → 2.2
    expect(r.durs[0]).toBeCloseTo(2.2 - GAP, 3);
  });
});
