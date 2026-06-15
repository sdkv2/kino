export interface SegmentTiming {
  index: number;
  startSec: number;
  endSec: number;
  durSec: number;
}
export interface VOResult {
  trackPath: string; // stitched continuous mp3
  timings: SegmentTiming[];
  totalSec: number;
}
