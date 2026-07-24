import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, statSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { FFMPEG_PATH } from "../src/media/binPaths.js";
import { coremlBackend } from "../src/segment/coreml.js";
import { readManifest } from "../src/segment/manifest.js";

// CoreML VIDEO seg on Apple Silicon: per-frame image segmentation (NO temporal tracking — the
// tracker's conditioning-frame memory-encode step isn't exported to CoreML; see
// docs/segmentation-tracking-todo.md). So manifest.tracked is ALWAYS false here. Runs for real on a
// configured Mac; skips off-darwin (CI) and without KINO_SAM_PYTHON. Per-frame CoreML is ~15-20s of
// model load + a few s/frame, so the fixture is a TINY, short, few-frame clip.
function samPython(): string {
  return process.env.KINO_SAM_PYTHON ?? join(homedir(), ".kino", "sam", "venv", "bin", "python");
}

describe("coreml video backend (mac)", () => {
  it.skipIf(process.platform !== "darwin" || !process.env.KINO_SAM_PYTHON || !existsSync(samPython()))(
    "segments a tiny clip → non-empty mask.mp4 + manifest kind=video, tracked=false",
    async () => {
      const outDir = mkdtempSync(join(tmpdir(), "kino-coreml-vid-"));
      const clip = join(outDir, "clip.mp4");
      // 0.5s @ 6fps = 3 frames, 128x128 (even dims for yuv420p): a light disc sliding right on dark —
      // something concrete to segment, kept tiny so per-frame CoreML stays fast.
      await execa(FFMPEG_PATH, [
        "-y", "-loglevel", "error",
        "-f", "lavfi", "-i", "color=black:s=128x128:r=6:d=0.5",
        "-vf", "geq=lum='if(lt(pow(X-40-60*T,2)+pow(Y-64,2),400),235,10)'",
        "-pix_fmt", "yuv420p",
        clip,
      ]);

      const res = await coremlBackend.run({
        input: clip, prompt: "circle", objects: 1, track: false, outDir,
      });

      const mask = join(outDir, "mask.mp4");
      expect(existsSync(mask)).toBe(true);
      expect(statSync(mask).size).toBeGreaterThan(0);
      const m = readManifest(outDir);
      expect(m.kind).toBe("video");
      expect(m.backend).toBe("coreml");
      expect(m.tracked).toBe(false); // per-frame path never claims tracking
      expect(m.width).toBe(128);
      expect(m.height).toBe(128);
      expect(m.fps).toBeGreaterThan(0);
      expect(m.frames).toBeGreaterThanOrEqual(1);
      expect(m.objects.length).toBeGreaterThanOrEqual(1);
      expect(res.outDir).toBe(outDir);
    },
    480_000,
  );
});
