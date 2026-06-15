export interface SegmentTiming {
  index: number;
  startSec: number;
  endSec: number;
  durSec: number;
}
import type { WordTiming } from "./render/props.js";

export interface VOResult {
  trackPath: string; // stitched continuous mp3 (all segments)
  clips: string[]; // per-segment mp3 paths, in order
  timings: SegmentTiming[];
  words: WordTiming[][]; // per-segment word timings, offset onto the main timeline
  totalSec: number;
}
