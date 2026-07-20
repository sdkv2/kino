// Loop-seam helpers: compare two equal-sized raw RGB24 buffers (ffmpeg rawvideo).
// Mean absolute channel difference in 0..255. Pure — unit-tested.

/** Mean abs per-channel diff. Buffers must be the same length (width*height*3). */
export function seamDiff(a: Buffer, b: Buffer): number {
  if (a.length !== b.length) throw new Error(`seamDiff: length mismatch ${a.length} vs ${b.length}`);
  if (!a.length) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i]! - b[i]!);
  return sum / a.length;
}

/** Soft threshold: encode noise stays under this; layout mismatch usually doesn't. */
export const SEAM_OK_MEAN = 2.5;
