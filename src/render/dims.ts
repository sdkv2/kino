// Pixel dimensions per output format — shared by the native engine and anything that needs to
// pre-render at the target resolution (e.g. Blender scene stills) before the frame loop starts.
import type { Format } from "../spec/schema.js";

export const DIMS: Record<Format, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "3:4": { width: 1080, height: 1440 },
  "16:9": { width: 1920, height: 1080 },
};
