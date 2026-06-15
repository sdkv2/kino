import { execa } from "execa";
import { mkdirSync } from "node:fs";
import { join, dirname, basename, extname } from "node:path";
import { parseTimes } from "../render/preview.js";
import { montage } from "../media/montage.js";
import { log } from "../log.js";

// Extract frames from an already-rendered video at given timestamps (post-build QA).
export async function frames(video: string, opts: { at?: string; out?: string; montage?: boolean }): Promise<void> {
  const times = parseTimes(opts.at ?? "");
  if (!times.length) throw new Error("kino frames needs --at <sec,sec,...>");
  const outDir = opts.out ?? join(dirname(video), "frames");
  mkdirSync(outDir, { recursive: true });
  const base = basename(video, extname(video));
  const outs: string[] = [];
  for (const t of times) {
    const out = join(outDir, `${base}-${t}s.png`);
    await execa("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(t), "-i", video, "-frames:v", "1", out]);
    outs.push(out);
    log.ok(out);
  }
  if (opts.montage) {
    const m = join(outDir, `${base}-montage.png`);
    await montage(outs.map((p, i) => ({ path: p, label: `${times[i]}s` })), m);
    log.ok(m);
  }
}
