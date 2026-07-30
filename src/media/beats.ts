// Beat-grid detection and cut quantization — the music-video machinery behind `kino sync`
// and the `grid` block in audio-markers. Pure math over decoded PCM (same contract as
// markers.ts): kick-band emphasis via a one-pole lowpass, a 10 ms onset-strength envelope,
// autocorrelation for the period, a comb search for the phase, then a joint fine
// refinement. Fits are LOCAL to the requested window — real tracks drift, so callers
// analyze the stretch they will actually play.

export interface BeatGrid {
  bpm: number;
  periodSec: number;
  phaseSec: number; // absolute time of a beat within the analyzed samples; beats at phaseSec + k·periodSec
  strength: number; // 0..1 — fraction of grid points backed by a real onset (≥ ~0.7 = sequenced-tight)
}

const HOP_SEC = 0.01; // 100 Hz envelope — onset timing to ±10 ms
const KICK_CUTOFF_HZ = 150;
const FINE_PERIOD_SPREAD = 0.06; // ±6% around the coarse period
const FINE_PERIOD_STEP = 0.0005;

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** One-pole IIR lowpass — enough to isolate the kick fundament from hats/leads. */
function lowpass(samples: Float32Array, sampleRate: number, cutoffHz: number): Float32Array {
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const dt = 1 / sampleRate;
  const alpha = dt / (rc + dt);
  const out = new Float32Array(samples.length);
  let y = 0;
  for (let i = 0; i < samples.length; i++) {
    y += alpha * (samples[i] - y);
    out[i] = y;
  }
  return out;
}

/** Positive energy deltas of the kick-band RMS envelope — one value per 10 ms hop. */
function onsetStrengths(samples: Float32Array, sampleRate: number): number[] {
  const low = lowpass(samples, sampleRate, KICK_CUTOFF_HZ);
  const hop = Math.round(sampleRate * HOP_SEC);
  const n = Math.floor(low.length / hop);
  const env: number[] = [];
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = i * hop; j < (i + 1) * hop; j++) sum += low[j] * low[j];
    env.push(Math.sqrt(sum / hop));
  }
  return env.map((v, i) => Math.max(0, v - (env[i - 1] ?? 0)));
}

/** Mean comb response of onset strengths for a (period, phase) pair inside [i0, i1). */
function combScore(o: number[], i0: number, i1: number, periodSec: number, phaseSec: number): number {
  let s = 0;
  let c = 0;
  for (let t = phaseSec; ; t += periodSec) {
    const i = i0 + Math.round(t / HOP_SEC);
    if (i >= i1) break;
    s += (o[i - 1] ?? 0) + (o[i] ?? 0) + (o[i + 1] ?? 0);
    c++;
  }
  return c ? s / c : 0;
}

export interface DetectOpts {
  windowStartSec?: number;
  windowEndSec?: number;
  minBpm?: number;
  maxBpm?: number;
}

/**
 * Detect the beat grid of `samples` (mono Float32) inside the given window.
 * Returns null when the audio carries no usable onset energy (silence, a flat pad).
 * A low `strength` on a non-null result means the grid is unreliable — callers
 * should warn before syncing cuts to it.
 */
export function detectBeatGrid(samples: Float32Array, sampleRate: number, opts: DetectOpts = {}): BeatGrid | null {
  const durationSec = samples.length / sampleRate;
  const start = Math.max(0, opts.windowStartSec ?? 0);
  const end = Math.min(durationSec, opts.windowEndSec ?? durationSec);
  if (end - start < 4) return null;
  const minBpm = opts.minBpm ?? 60;
  const maxBpm = opts.maxBpm ?? 200;

  const o = onsetStrengths(samples, sampleRate);
  const i0 = Math.round(start / HOP_SEC);
  const i1 = Math.min(o.length, Math.round(end / HOP_SEC));
  const win = o.slice(i0, i1);
  const total = win.reduce((s, v) => s + v, 0);
  if (total < 1e-4) return null;

  // Coarse period: autocorrelation of onset strengths, weighted 1/√lag so the true
  // period beats its own 2× harmonic.
  const minLag = Math.max(1, Math.round(60 / maxBpm / HOP_SEC));
  const maxLag = Math.min(win.length - 1, Math.round(60 / minBpm / HOP_SEC));
  if (maxLag <= minLag) return null;
  let coarseLag = minLag;
  let bestW = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let r = 0;
    for (let i = 0; i + lag < win.length; i++) r += win[i] * win[i + lag];
    r /= win.length - lag;
    const w = r / Math.sqrt(lag * HOP_SEC);
    if (w > bestW) {
      bestW = w;
      coarseLag = lag;
    }
  }
  const coarse = coarseLag * HOP_SEC;

  // Fine joint search: period ±6% at 0.5 ms steps, phase at envelope resolution.
  let best = { per: coarse, ph: 0, s: -1 };
  const perLo = coarse * (1 - FINE_PERIOD_SPREAD);
  const perHi = coarse * (1 + FINE_PERIOD_SPREAD);
  for (let per = perLo; per <= perHi; per += FINE_PERIOD_STEP) {
    for (let ph = 0; ph < per; ph += HOP_SEC) {
      const s = combScore(o, i0, i1, per, ph);
      if (s > best.s) best = { per, ph, s };
    }
  }

  // Strength: how many grid points sit on a real onset (local strength well above the
  // window's median).
  const sorted = [...win].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const maxO = sorted[sorted.length - 1];
  const hitFloor = Math.max(3 * median, 0.1 * maxO, 1e-4);
  let hits = 0;
  let points = 0;
  for (let t = best.ph; ; t += best.per) {
    const i = i0 + Math.round(t / HOP_SEC);
    if (i >= i1) break;
    points++;
    const local = Math.max(o[i - 1] ?? 0, o[i] ?? 0, o[i + 1] ?? 0);
    if (local > hitFloor) hits++;
  }
  if (!points) return null;

  return {
    bpm: r3(60 / best.per),
    periodSec: r3(best.per),
    phaseSec: r3(start + best.ph),
    strength: Math.round((hits / points) * 100) / 100,
  };
}

/**
 * Pick the on-grid start time whose following `windowSec` of audio is loudest (and has
 * no dropout) — the auto-offset for a music bed under a video of that length.
 */
export function pickLoudestGridStart(samples: Float32Array, sampleRate: number, grid: BeatGrid, windowSec: number): number {
  const durationSec = samples.length / sampleRate;
  const hop = Math.round(sampleRate * 0.1);
  const n = Math.floor(samples.length / hop);
  const env: number[] = [];
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = i * hop; j < (i + 1) * hop; j++) sum += samples[j] * samples[j];
    env.push(Math.sqrt(sum / hop));
  }
  let best = grid.phaseSec;
  let bestScore = -1;
  for (let t = grid.phaseSec; t + windowSec <= durationSec + 1e-9; t += grid.periodSec) {
    const a = Math.round(t / 0.1);
    const b = Math.min(env.length, Math.round((t + windowSec) / 0.1));
    if (b <= a) break;
    const slice = env.slice(a, b);
    const mean = slice.reduce((s, v) => s + v, 0) / slice.length;
    const min = Math.min(...slice);
    const score = mean + min;
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return r3(best);
}

export interface CutSolveInput {
  segments: Array<{ durSec: number; editable: boolean }>; // beat lengths EXCLUDING the inter-beat gap
  gapSec: number; // fixed inter-beat gap (0.32 in kino)
  periodSec: number;
  phaseSec: number; // grid phase in VIDEO time (0 = a beat lands exactly at t=0)
  grainBeats: number; // cuts snap to every `grainBeats`-th beat (4 = bars in 4/4)
  minDurSec?: number; // floor for a rewritten dur (default 0.6)
}

export interface CutChange {
  index: number; // segment index the cut starts (segments.length = the video end)
  beforeSec: number;
  afterSec: number;
  deltaMs: number;
  onGrid: boolean;
}

export interface CutSolveResult {
  durs: number[];
  cuts: CutChange[];
}

/**
 * Quantize the timeline's cut points to the beat grid by rewriting editable durations.
 * Uneditable segments (VO-driven beats) pass through unchanged; the next editable
 * segment re-anchors the timeline onto the grid. The video end quantizes too when the
 * last segment is editable.
 */
export function solveCutDurations(input: CutSolveInput): CutSolveResult {
  const { segments, gapSec, periodSec, phaseSec, grainBeats } = input;
  const minDur = input.minDurSec ?? 0.6;
  const G = grainBeats * periodSec;
  const eps = 0.002;
  const onGrid = (t: number) => {
    const rel = (((t - phaseSec) % G) + G) % G;
    return Math.min(rel, G - rel) < eps;
  };

  const durs: number[] = [];
  const cuts: CutChange[] = [];
  let t = 0;
  segments.forEach((seg, i) => {
    const isLast = i === segments.length - 1;
    const gap = isLast ? 0 : gapSec;
    const raw = t + seg.durSec + gap;
    if (!seg.editable) {
      durs.push(seg.durSec);
      cuts.push({ index: i + 1, beforeSec: r3(raw), afterSec: r3(raw), deltaMs: 0, onGrid: onGrid(raw) });
      t = raw;
      return;
    }
    let cand = phaseSec + Math.round((raw - phaseSec) / G) * G;
    const minNext = t + minDur + gap;
    while (cand < minNext - 1e-9) cand += G;
    durs.push(r3(cand - t - gap));
    cuts.push({ index: i + 1, beforeSec: r3(raw), afterSec: r3(cand), deltaMs: Math.round((cand - raw) * 1000), onGrid: true });
    t = cand;
  });
  return { durs, cuts };
}
