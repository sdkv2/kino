import { mkdirSync } from "node:fs";
import { join, dirname, basename, extname } from "node:path";
import { parseTimes, pickIntervalTimes } from "../render/preview.js";
import { probeDuration, extractFrame } from "../media/ffmpeg.js";
import { montage } from "../media/montage.js";
import { log } from "../log.js";

// Extract frames from a video at given timestamps. For unknown clips, --count / --every pick times
// from the probed duration. Precedence: --at > --count > --every.
export async function frames(
  video: string,
  opts: { at?: string; out?: string; montage?: boolean; every?: string; count?: string },
): Promise<void> {
  let times = opts.at ? parseTimes(opts.at) : [];
  if (!times.length && (opts.count || opts.every)) {
    const dur = await probeDuration(video);
    times = pickIntervalTimes(dur, {
      count: opts.count ? Number(opts.count) : undefined,
      every: opts.every ? Number(opts.every) : undefined,
    });
  }
  if (!times.length) throw new Error("kino frames needs --at <sec,...> (or --count <n> / --every <sec>)");
  const outDir = opts.out ?? join(dirname(video), "frames");
  mkdirSync(outDir, { recursive: true });
  const base = basename(video, extname(video));
  const outs: string[] = [];
  for (const t of times) {
    const out = join(outDir, `${base}-${t}s.png`);
    await extractFrame(video, t, out);
    outs.push(out);
    log.ok(out);
  }
  if (opts.montage) {
    const m = join(outDir, `${base}-montage.png`);
    await montage(outs.map((p, i) => ({ path: p, label: `${times[i]}s` })), m);
    log.ok(m);
  }
}
