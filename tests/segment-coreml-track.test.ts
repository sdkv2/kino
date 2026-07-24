import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, statSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { FFMPEG_PATH } from "../src/media/binPaths.js";
import { coremlBackend } from "../src/segment/coreml.js";
import { readManifest } from "../src/segment/manifest.js";

// CoreML REAL video tracking on Apple Silicon: frame-0 text→mask (CoreML image seg) seeds a PyTorch
// mask-prompt init, then the stateful CoreML tracker propagates the mask across frames → manifest
// tracked:true. Runs for real on a configured Mac; skips off-darwin (CI) and without KINO_SAM_PYTHON.
// ~1.9s/frame with CoreML vision backbone + every=2 (PyTorch CPU fallback ~7–8s), so the fixture is a
// TINY 8-frame 384px clip and the timeout is generous. Verifies not just that a mask exists but
// that it MOVES with the object.
function samPython(): string {
  return process.env.KINO_SAM_PYTHON ?? join(homedir(), ".kino", "sam", "venv", "bin", "python");
}
const W = 384;
const H = 384;

/** Decode mask.mp4 to raw gray8 and return each frame's mask-centroid x (null if empty). */
async function centroidsX(mp4: string): Promise<(number | null)[]> {
  const { stdout } = await execa(
    FFMPEG_PATH,
    ["-loglevel", "error", "-i", mp4, "-pix_fmt", "gray", "-f", "rawvideo", "-"],
    { encoding: "buffer" },
  );
  const buf = stdout as unknown as Buffer;
  const per = W * H;
  const out: (number | null)[] = [];
  for (let f = 0; f * per < buf.length; f++) {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < per; i++) {
      if (buf[f * per + i] > 127) {
        sum += i % W;
        n++;
      }
    }
    out.push(n ? sum / n : null);
  }
  return out;
}

describe("coreml video tracking (mac)", () => {
  it.skipIf(process.platform !== "darwin" || !process.env.KINO_SAM_PYTHON || !existsSync(samPython()))(
    "tracks a moving disc → mask.mp4, tracked:true, centroid follows the disc",
    async () => {
      const outDir = mkdtempSync(join(tmpdir(), "kino-coreml-track-"));
      const clip = join(outDir, "clip.mp4");
      // 8 frames @ 8fps, 384px: a bright disc (r=40) sliding right (X_center = 60 + 280*T, so it
      // travels ~245px over the clip). A concrete object whose known trajectory the mask must follow.
      await execa(FFMPEG_PATH, [
        "-y", "-loglevel", "error",
        "-f", "lavfi", "-i", `color=black:s=${W}x${H}:r=8:d=1.0`,
        "-vf", "geq=lum='if(lt(pow(X-60-280*T,2)+pow(Y-192,2),1600),235,10)'",
        "-frames:v", "8", "-pix_fmt", "yuv420p",
        clip,
      ]);

      const res = await coremlBackend.run({
        input: clip, prompt: "circle", objects: 1, track: true, outDir,
      });

      const mask = join(outDir, "mask.mp4");
      expect(existsSync(mask)).toBe(true);
      expect(statSync(mask).size).toBeGreaterThan(0);
      const m = readManifest(outDir);
      expect(m.kind).toBe("video");
      expect(m.backend).toBe("coreml");
      expect(m.tracked).toBe(true); // real temporal tracking
      expect(m.width).toBe(W);
      expect(m.height).toBe(H);
      expect(m.frames).toBeGreaterThanOrEqual(6);
      expect(res.outDir).toBe(outDir);

      // The mask must actually TRACK: its centroid moves rightward with the disc, not frozen/empty.
      const cx = await centroidsX(mask);
      const first = cx[1]; // frame 1 (frame 0 is the seeding seg mask)
      const last = cx.filter((v) => v !== null).at(-1) as number;
      expect(first).not.toBeNull();
      expect(last).not.toBeNull();
      // Disc moves ~35px/frame rightward; mask centroid must clearly follow it (not drift a few px).
      expect(last - (first as number)).toBeGreaterThan(100);
    },
    600_000,
  );
});
