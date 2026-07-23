import type { KinoProps, KinoSegment } from "./props.js";

export interface SegmentSummary {
  index: number;
  kind: string;
  startSec: number;
  endSec: number;
  durSec: number;
  captionMode: string;
  asset?: string;
  hasKicker: boolean;
}

export interface InspectPlan {
  fps: number;
  durationSec: number;
  faceless: boolean;
  background: string;
  segments: SegmentSummary[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// Machine-readable summary of the resolved render plan — the agent's map of every beat.
export function inspectPlan(props: KinoProps): InspectPlan {
  const segments = props.segments.map((s, index) => ({
    index,
    kind: s.kind,
    startSec: s.startSec,
    endSec: s.endSec,
    durSec: round2(s.endSec - s.startSec),
    captionMode: s.captionMode ?? "phrase",
    ...(s.asset ? { asset: s.asset } : {}),
    hasKicker: !!s.kicker,
  }));
  return {
    fps: props.fps,
    durationSec: round2(Math.max(0, ...props.segments.map((s) => s.endSec))),
    faceless: props.avatar === null,
    background: props.background.kind,
    segments,
  };
}

// "1,3.5,9" → [1,3.5,9], dropping anything that isn't a number.
export function parseTimes(s: string): number[] {
  return s
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isFinite(n));
}

export interface FramePick {
  frame: number;
  label: string;
}

type FrameSelection = { at?: number[]; segment?: number };
type SegLike = Pick<KinoSegment, "kind" | "startSec" | "endSec">;

const mid = (s: SegLike, fps: number) => Math.round(((s.startSec + s.endSec) / 2) * fps);

// Which frames to grab: explicit timestamps, one segment's midpoint, or (default) one per beat.
export function pickFrames(segments: SegLike[], fps: number, sel: FrameSelection, perBeat = 1): FramePick[] {
  if (sel.at && sel.at.length) {
    return sel.at.map((t) => ({ frame: Math.round(t * fps), label: `${t}s` }));
  }
  if (sel.segment != null) {
    const s = segments[sel.segment];
    if (!s) throw new Error(`--segment ${sel.segment} out of range (spec has ${segments.length} segments, 0-indexed 0..${segments.length - 1})`);
    return [{ frame: mid(s, fps), label: `${sel.segment} ${s.kind}` }];
  }
  // Default (storyboard): perBeat frames per beat. perBeat===1 keeps the legacy single midpoint.
  // For perBeat>1 we sample from 0.45→0.9 of each beat so the LAST frame shows the caption fully
  // revealed — words-mode reveals across the whole beat, so a midpoint-only frame hides the
  // end-state where a caption overflows the frame or collides with a `texts` overlay.
  return segments.flatMap((s, i) => {
    if (perBeat <= 1) return [{ frame: mid(s, fps), label: `${i} ${s.kind} ${s.startSec.toFixed(1)}s` }];
    return Array.from({ length: perBeat }, (_, j) => {
      const at = s.startSec + (0.45 + (0.9 - 0.45) * (j / (perBeat - 1))) * (s.endSec - s.startSec);
      return { frame: Math.round(at * fps), label: `${i} ${s.kind} ${at.toFixed(1)}s${j === perBeat - 1 ? " ·full" : ""}` };
    });
  });
}

// Frame timestamps across a clip of known duration when the agent doesn't know exact times:
// `count` → N points spaced evenly and inset from both ends; `every` → one every N seconds,
// centred. Precedence count > every. Empty when neither is set.
export function pickIntervalTimes(durationSec: number, opts: { count?: number; every?: number }): number[] {
  if (opts.count && opts.count > 0) {
    const step = durationSec / (opts.count + 1);
    return Array.from({ length: opts.count }, (_, i) => round2(step * (i + 1)));
  }
  if (opts.every && opts.every > 0) {
    const out: number[] = [];
    for (let t = opts.every / 2; t < durationSec; t += opts.every) out.push(round2(t));
    return out.length ? out : [round2(durationSec / 2)];
  }
  return [];
}

// N timestamps centered on `center`, spanning `span` seconds total (center ± span/2).
// Used by `kino still --around` / `kino frames --around` to sheet a moment for QA.
export function timesAround(
  center: number,
  opts: { count?: number; span?: number; min?: number; max?: number } = {},
): number[] {
  const count = Math.max(1, Math.round(opts.count ?? 5));
  const span = Number.isFinite(opts.span) ? Number(opts.span) : 1;
  const half = span / 2;
  const raw =
    count === 1
      ? [center]
      : Array.from({ length: count }, (_, i) => center - half + (span * i) / (count - 1));
  const lo = opts.min ?? -Infinity;
  const hi = opts.max ?? Infinity;
  return raw.map((t) => round2(Math.min(hi, Math.max(lo, t))));
}
