export interface SegmentTiming {
  index: number;
  startSec: number;
  endSec: number;
  durSec: number;
}
export interface VOResult {
  trackPath: string; // stitched continuous mp3 (all segments)
  clips: string[]; // per-segment mp3 paths, in order
  timings: SegmentTiming[];
  totalSec: number;
}
