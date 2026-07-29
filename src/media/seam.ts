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

export interface FrameStats {
  /** Distinct colours after 5-bit-per-channel quantisation (max 32768). */
  colors: number;
  /** Mean luma 0..255 (Rec. 601). */
  luma: number;
  /** Mean per-pixel chroma spread — max(r,g,b) − min(r,g,b), 0..255. */
  chroma: number;
  /** Peak per-pixel chroma. The mean is useless on a mostly-black frame — a small saturated element
   *  averages away to nothing — so "is any colour present" has to be answered by the peak. */
  chromaMax: number;
  /** Fraction of pixels (0..1) whose chroma clears CHROMATIC_PX — how much of the frame is coloured,
   *  as opposed to merely tinted. */
  chromaticPx: number;
}

/** Per-pixel chroma at or above which a pixel counts as genuinely coloured rather than tinted. */
export const CHROMATIC_PX = 24;

/**
 * Cheap per-frame descriptors, for reporting alongside a render so "it looks right" becomes checkable.
 *
 * `colors` and `chroma` exist because the defect they catch is invisible to any motion metric: a beat
 * whose signature effect was eight coloured smear blobs rendered as a pure greyscale opacity fade, and
 * the numbers said so instantly — 268 distinct colours against the reference's 3951, chroma ~0. The
 * frames animated, so no diff-based check could object; only "is there any colour in here" could.
 *
 * Quantising to 5 bits bounds the set at 32768 buckets so this stays O(pixels) with a fixed footprint.
 */
export function frameStats(buf: Buffer): FrameStats {
  const px = Math.floor(buf.length / 3);
  if (!px) return { colors: 0, luma: 0, chroma: 0, chromaMax: 0, chromaticPx: 0 };
  const seen = new Uint8Array(1 << 15);
  let colors = 0;
  let lumaSum = 0;
  let chromaSum = 0;
  let chromaMax = 0;
  let chromatic = 0;
  for (let i = 0; i < px * 3; i += 3) {
    const r = buf[i]!;
    const g = buf[i + 1]!;
    const b = buf[i + 2]!;
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    if (!seen[key]) {
      seen[key] = 1;
      colors++;
    }
    lumaSum += 0.299 * r + 0.587 * g + 0.114 * b;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    chromaSum += chroma;
    if (chroma > chromaMax) chromaMax = chroma;
    if (chroma >= CHROMATIC_PX) chromatic++;
  }
  return {
    colors,
    luma: lumaSum / px,
    chroma: chromaSum / px,
    chromaMax,
    chromaticPx: chromatic / px,
  };
}

/**
 * Mean abs channel diff per tile, over a `cols`×`rows` grid of an equal-sized RGB24 frame pair.
 *
 * The frame-wide mean cannot tell "the subject moved" from "the background breathed": a full-screen
 * gradient wash nudges every pixel a little, which averages to the same small number as a frozen
 * subject with a drifting glow behind it. Tiling separates them — a wash lifts every tile slightly,
 * real motion lifts a few tiles a lot — so callers can threshold on the MAX tile instead.
 *
 * Row-major, `rows * cols` entries. Trailing pixels fold into the last tile when the frame does not
 * divide evenly, so every pixel is counted exactly once.
 */
export function tileDiffs(
  a: Buffer,
  b: Buffer,
  width: number,
  height: number,
  cols = 8,
  rows = 8,
): number[] {
  if (a.length !== b.length) throw new Error(`tileDiffs: length mismatch ${a.length} vs ${b.length}`);
  const need = width * height * 3;
  if (a.length !== need) throw new Error(`tileDiffs: expected ${need} bytes for ${width}x${height}, got ${a.length}`);
  if (cols < 1 || rows < 1) throw new Error(`tileDiffs: need a positive grid, got ${cols}x${rows}`);
  if (!a.length) return [];

  const out: number[] = [];
  for (let ty = 0; ty < rows; ty++) {
    // Last tile absorbs the remainder rather than dropping it.
    const y0 = Math.floor((ty * height) / rows);
    const y1 = ty === rows - 1 ? height : Math.floor(((ty + 1) * height) / rows);
    for (let tx = 0; tx < cols; tx++) {
      const x0 = Math.floor((tx * width) / cols);
      const x1 = tx === cols - 1 ? width : Math.floor(((tx + 1) * width) / cols);
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        const row = y * width * 3;
        for (let i = row + x0 * 3; i < row + x1 * 3; i++) {
          sum += Math.abs(a[i]! - b[i]!);
          n++;
        }
      }
      out.push(n ? sum / n : 0);
    }
  }
  return out;
}
