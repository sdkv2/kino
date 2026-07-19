import { mkdirSync } from "node:fs";
import { join, dirname, basename, extname } from "node:path";
import { parseTimes, pickIntervalTimes, timesAround } from "../render/preview.js";
import { probeDuration, extractFrame } from "../media/ffmpeg.js";
import { montage } from "../media/montage.js";
import { log } from "../log.js";

// Extract frames from a video at given timestamps. For unknown clips, --count / --every pick times
// from the probed duration. Precedence: --at > --around > --count > --every.
export async function frames(
  video: string,
  opts: {
    at?: string;
    around?: string;
    span?: string;
    out?: string;
    montage?: boolean;
    every?: string;
    count?: string;
  },
): Promise<void> {
  let times = opts.at ? parseTimes(opts.at) : [];
  if (!times.length && opts.around != null) {
    const center = Number(opts.around);
    if (!Number.isFinite(center)) throw new Error(`kino frames --around needs a number (got ${opts.around})`);
    const dur = await probeDuration(video);
    times = timesAround(center, {
      count: opts.count ? Number(opts.count) : undefined,
      span: opts.span ? Number(opts.span) : undefined,
      min: 0,
      max: dur,
    });
  }
  if (!times.length && (opts.count || opts.every)) {
    const dur = await probeDuration(video);
    times = pickIntervalTimes(dur, {
      count: opts.count ? Number(opts.count) : undefined,
      every: opts.every ? Number(opts.every) : undefined,
    });
  }
  if (!times.length) {
    throw new Error("kino frames needs --at <sec,...>, --around <sec>, or --count <n> / --every <sec>");
  }
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
  const wantMontage = opts.montage || opts.around != null;
  if (wantMontage && outs.length > 1) {
    const tag = opts.around != null ? `around-${opts.around}s` : "montage";
    const m = join(outDir, `${base}-${tag}.png`);
    await montage(outs.map((p, i) => ({ path: p, label: `${times[i]}s` })), m, { cols: outs.length });
    log.ok(m);
  }
}
