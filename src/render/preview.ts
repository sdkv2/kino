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
export function pickFrames(segments: SegLike[], fps: number, sel: FrameSelection): FramePick[] {
  if (sel.at && sel.at.length) {
    return sel.at.map((t) => ({ frame: Math.round(t * fps), label: `${t}s` }));
  }
  if (sel.segment != null) {
    const s = segments[sel.segment];
    return [{ frame: mid(s, fps), label: `${sel.segment} ${s.kind}` }];
  }
  return segments.map((s, i) => ({ frame: mid(s, fps), label: `${i} ${s.kind} ${s.startSec.toFixed(1)}s` }));
}
