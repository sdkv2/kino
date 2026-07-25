// Turns mask rasters into signed-distance-field rasters for kinoMaskDist.
//
// The maths lives in src/render/sdf.ts (pure, unit-tested). This module is the I/O around it:
// decode PNGs → signedDistance per used channel → encode PNGs. ffmpeg does both conversions, so
// this adds no image dependency — it is already a hard requirement of every render.
//
// One ffmpeg reads the whole mask frame sequence as raw RGBA on stdout and one writes the SDF
// sequence from raw RGBA on stdin, so a 156-frame mask costs two processes rather than 312. Frames
// stream through, so peak memory is a couple of frames, not the sequence.
//
// SDF_MAX_PX is FIXED rather than fitted per mask. Fitting would need a measuring pass over every
// frame before any could be written (the encode range has to be constant across a beat — it reaches
// the shader as one uniform), and 8 bits over ±128px already gives ~1px steps. That is an order of
// magnitude more reach than the in-shader search resolves accurately today, and `radius` clamps the
// result anyway, so the cap costs nothing any real effect can see.
import { spawn } from "node:child_process";
import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FFMPEG_PATH } from "../../media/binPaths.js";
import { encodeSdfRGBA, signedDistance, SDF_MAX_PX } from "../sdf.js";

export { SDF_MAX_PX };

function run(args: string[], onStdout?: (b: Buffer) => void, stdin?: NodeJS.ReadableStream): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG_PATH, args, { stdio: [stdin ? "pipe" : "ignore", onStdout ? "pipe" : "ignore", "ignore"] });
    if (onStdout) p.stdout!.on("data", onStdout);
    p.on("error", reject);
    p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg exited ${c}`))));
  });
}

/** Which RGBA channels a beat actually reads, so a single-object mask does not pay for four EDTs. */
export function channelIndices(channels: readonly string[]): number[] {
  const map: Record<string, number> = { r: 0, g: 1, b: 2, a: 3, gray: 0 };
  return [...new Set(channels.map((c) => map[c] ?? 0))].sort((a, b) => a - b);
}

/** Linear downscale factor for the stored field. A distance field is smooth and band-limited, so
 *  half resolution costs about one full-res pixel of accuracy — inside the ~1px quantisation the
 *  8-bit encode already imposes — while being 4x smaller on disk AND 4x cheaper to compute (the EDT
 *  runs on the reduced grid, not on the full frame). It matters: measured on a real 1080x1920 mask,
 *  a full-res field PNG is 127 KB against the binary mask's 13 KB, because a smooth gradient does
 *  not compress like a silhouette. At half res that is ~32 KB. The shader samples by normalised uv,
 *  so the stored resolution is invisible to it. */
export const SDF_SCALE = 2;

/** Box-downsample one channel's coverage to 1/SDF_SCALE, as 0/255 occupancy. */
function reduceChannel(rgba: Uint8Array, w: number, h: number, c: number, rw: number, rh: number): Uint8Array {
  const out = new Uint8Array(rw * rh);
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      let sum = 0;
      let cnt = 0;
      for (let dy = 0; dy < SDF_SCALE; dy++) {
        const sy = y * SDF_SCALE + dy;
        if (sy >= h) break;
        for (let dx = 0; dx < SDF_SCALE; dx++) {
          const sx = x * SDF_SCALE + dx;
          if (sx >= w) break;
          sum += rgba[(sy * w + sx) * 4 + c];
          cnt++;
        }
      }
      out[y * rw + x] = cnt && sum / cnt >= 127.5 ? 255 : 0;
    }
  }
  return out;
}

/** Reduced dimensions of the stored field for a mask of these dimensions. */
export const sdfDims = (w: number, h: number) => ({
  width: Math.max(1, Math.ceil(w / SDF_SCALE)),
  height: Math.max(1, Math.ceil(h / SDF_SCALE)),
});

/** Convert one RGBA mask frame to a REDUCED RGBA SDF frame, for the given channels only.
 *  Distances are scaled back to FULL-resolution pixels before encoding, so the shader's decode is
 *  independent of SDF_SCALE. */
export function sdfFrameRGBA(rgba: Uint8Array, w: number, h: number, chans: number[]): Uint8Array {
  const { width: rw, height: rh } = sdfDims(w, h);
  // Sparse by design: a beat reading only channel 0 computes one field, not four. encodeSdfRGBA
  // leaves the untouched channels at +maxDist (fully outside), which is what an unbound object must
  // read as — the same "unbound contributes nothing" rule uChannelN's zero vector gives the mask.
  const fields: (Float32Array | null)[] = [null, null, null, null];
  for (const c of chans) {
    const d = signedDistance(reduceChannel(rgba, w, h, c, rw, rh), rw, rh);
    // The EDT ran on the reduced grid, so its units are reduced pixels — rescale to full-res px.
    for (let i = 0; i < d.length; i++) d[i] *= SDF_SCALE;
    fields[c] = d;
  }
  return encodeSdfRGBA(fields, rw, rh, SDF_MAX_PX);
}

// NO TEMPORAL FILTERING HERE, and that is a measured decision rather than an omission.
//
// A tracked mask's boundary looks like it shimmers, and the obvious reading is that SAM re-decides
// the silhouette every frame. Measured on the duet mask (1080x1920, held pose, centroid travel
// 0.7-0.8 px/frame), 1.7-2.0k pixels of a ~2.5k-pixel perimeter change per frame — which certainly
// looks like noise. It is not. Coverage change by frame lag:
//
//   lag 1 -> 2.69k px | lag 2 -> 5.04k | lag 4 -> 9.72k | lag 8 -> 18.67k
//
// That is LINEAR in lag. Uncorrelated noise plateaus (two independently noisy frames differ about
// as much at lag 8 as at lag 1); linear growth means the boundary moves coherently and stays moved.
// The churn is real motion — a 2.5k perimeter advancing ~1px per frame IS ~2.5k changed pixels.
//
// Both filters were built and measured against it before this conclusion: a temporal median of the
// mask cut churn 2.53k -> 2.31k (9%), and a 5-frame mean of the signed distance 2.53k -> 2.18k
// (14%). Neither is worth blurring genuine movement for. If an edge ever reads as unsteady, the
// lever is the COMPOSITE — feathering the region seam over a couple of pixels using the field —
// not smearing the mask through time.


/** Compute the full-resolution signed field for each used channel of one mask frame. */
function fieldsOf(rgba: Uint8Array, w: number, h: number, chans: number[]): (Float32Array | null)[] {
  const n = w * h;
  const fields: (Float32Array | null)[] = [null, null, null, null];
  for (const c of chans) {
    const cov = new Uint8Array(n);
    for (let i = 0; i < n; i++) cov[i] = rgba[i * 4 + c];
    fields[c] = signedDistance(cov, w, h);
  }
  return fields;
}

/** Box-downsample a full-res field to the stored resolution, averaging distances. */
function reduceField(f: Float32Array, w: number, h: number, rw: number, rh: number): Float32Array {
  const out = new Float32Array(rw * rh);
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      let sum = 0, cnt = 0;
      for (let dy = 0; dy < SDF_SCALE; dy++) {
        const sy = y * SDF_SCALE + dy;
        if (sy >= h) break;
        for (let dx = 0; dx < SDF_SCALE; dx++) {
          const sx = x * SDF_SCALE + dx;
          if (sx >= w) break;
          sum += f[sy * w + sx];
          cnt++;
        }
      }
      out[y * rw + x] = cnt ? sum / cnt : SDF_MAX_PX;
    }
  }
  return out;
}

/** Build the SDF sequence for an extracted mask sequence. `srcPattern`/`outPattern` are printf
 *  patterns. Returns the directory written, or null if the source is missing.
 *
 *
 *  Idempotent: a completed set is detected and reused, because this is the expensive step. */
export async function writeSdfSequence(opts: {
  srcPattern: string;
  outDir: string;
  outPattern: string;
  width: number;
  height: number;
  channels: readonly string[];
}): Promise<string | null> {
  const { srcPattern, outDir, outPattern, width, height } = opts;
  // Idempotency comes from the first output frame existing, not a marker file: the frames dir is a
  // fresh temp dir per render, so a marker would never survive to be read — it would only litter a
  // directory that other code lists.
  if (existsSync(outPattern.replace("%06d", "000001"))) return outDir;
  mkdirSync(outDir, { recursive: true });

  const chans = channelIndices(opts.channels);
  const frameBytes = width * height * 4;
  const red = sdfDims(width, height);

  // Decode every frame's full-res fields first. Only the FIELDS are retained (one Float32Array per
  // used channel per frame), never the RGBA frames — for a 156-frame single-object 1080x1920 mask
  // that is ~1.3 GB of frames avoided for ~1.3 GB of field... so cap it: fields are reduced to the
  // stored resolution for retention and the temporal mean runs there, then the stabilised mask is
  // reconstructed by upsampling. At SDF_SCALE=2 that is 4x less memory and the ~1px it costs is
  // already inside the encode's quantisation.
  const perFrame: (Float32Array | null)[][] = [];
  let carry: Buffer = Buffer.alloc(0);

  await run(
    // -start_number 1: extractIndices names frames from x000001, and the image2 demuxer otherwise
    // looks for x000000, finds nothing, and exits 0 having produced no frames.
    ["-hide_banner", "-loglevel", "error", "-start_number", "1", "-i", srcPattern,
     "-f", "rawvideo", "-pix_fmt", "rgba", "-"],
    (chunk) => {
      carry = carry.length ? Buffer.concat([carry, chunk]) : Buffer.from(chunk);
      while (carry.length >= frameBytes) {
        const frame = Uint8Array.from(carry.subarray(0, frameBytes));
        carry = Buffer.from(carry.subarray(frameBytes));
        const full = fieldsOf(frame, width, height, chans);
        perFrame.push(full.map((f) => (f ? reduceField(f, width, height, red.width, red.height) : null)));
      }
    },
  );
  const total = perFrame.length;
  if (!total) return null;

  // The field the shader samples, at the stored resolution.
  const enc = spawn(
    FFMPEG_PATH,
    ["-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba",
     // Output numbering must match the mask frames one-for-one: byFrame maps x000001 -> s000001.
     "-s", `${red.width}x${red.height}`, "-i", "-", "-start_number", "1", outPattern],
    { stdio: ["pipe", "ignore", "ignore"] },
  );
  const done = new Promise<void>((resolve, reject) => {
    enc.on("error", reject);
    enc.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg exited ${c}`))));
  });
  for (const fields of perFrame) enc.stdin.write(Buffer.from(encodeSdfRGBA(fields, red.width, red.height, SDF_MAX_PX)));
  enc.stdin.end();
  await done;
  return outDir;
}

/** Single-image variant for an image mask (mask.png). Writes `dest` and returns it. */
export async function writeSdfImage(src: string, dest: string, channels: readonly string[]): Promise<string | null> {
  if (existsSync(dest)) return dest;
  if (!existsSync(src)) return null;
  const probe = spawn(FFMPEG_PATH, ["-hide_banner", "-loglevel", "error", "-i", src, "-f", "rawvideo", "-pix_fmt", "rgba", "-"], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  const chunks: Buffer[] = [];
  probe.stdout.on("data", (c: Buffer) => chunks.push(c));
  await new Promise<void>((resolve, reject) => {
    probe.on("error", reject);
    probe.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg exited ${c}`))));
  });
  const raw = Buffer.concat(chunks);
  // Dimensions come from the raw size and the source's own aspect — read them off the PNG header.
  const png = readFileSync(src);
  const w = png.readUInt32BE(16);
  const h = png.readUInt32BE(20);
  if (raw.length < w * h * 4) return null;
  const sdf = sdfFrameRGBA(raw, w, h, channelIndices(channels));
  const red = sdfDims(w, h);
  const enc = spawn(
    FFMPEG_PATH,
    ["-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${red.width}x${red.height}`, "-i", "-", dest],
    { stdio: ["pipe", "ignore", "ignore"] },
  );
  const done = new Promise<void>((resolve, reject) => {
    enc.on("error", reject);
    enc.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg exited ${c}`))));
  });
  enc.stdin.end(Buffer.from(sdf));
  await done;
  return dest;
}
