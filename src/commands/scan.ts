import { mkdirSync } from "node:fs";
import { join, dirname, basename, extname } from "node:path";
import { transcribe } from "./transcribe.js";
import { extractFrame } from "../media/ffmpeg.js";
import { montage } from "../media/montage.js";
import { pickIntervalTimes } from "../render/preview.js";
import type { Transcript } from "../render/transcript.js";
import { log } from "../log.js";

const round2 = (n: number) => Math.round(n * 100) / 100;

// RESEARCH tool: one shot to "view" an EXTERNAL reference video — transcript + frames + contact
// sheet. Not for our own renders or the build pipeline (see commands/transcribe.ts header).
export async function scan(
  video: string,
  opts: { count?: string; every?: string; out?: string; mock?: boolean },
): Promise<{ dir: string; transcriptPath: string; frames: string[]; montagePath: string }> {
  const base = basename(video, extname(video));
  const dir = opts.out ?? join(dirname(video), `${base}-scan`);
  mkdirSync(dir, { recursive: true });
  const transcriptPath = join(dir, "transcript.json");
  const t = await transcribe(video, { format: "json", out: transcriptPath, mock: opts.mock });

  let times: number[];
  if (opts.count || opts.every) {
    times = pickIntervalTimes(t.durationSec, {
      count: opts.count ? Number(opts.count) : undefined,
      every: opts.every ? Number(opts.every) : undefined,
    });
  } else {
    times = t.segments.map((s) => round2((s.start + s.end) / 2));
  }
  if (!times.length) times = [round2(t.durationSec / 2)];

  const frames: string[] = [];
  for (const tm of times) {
    const out = join(dir, `${base}-${tm}s.png`);
    await extractFrame(video, tm, out);
    frames.push(out);
  }
  const montagePath = join(dir, `${base}-scan.png`);
  await montage(times.map((tm, i) => ({ path: frames[i], label: labelFor(t, tm) })), montagePath);
  log.ok(transcriptPath);
  log.ok(montagePath);
  return { dir, transcriptPath, frames, montagePath };
}

function labelFor(t: Transcript, tm: number): string {
  const seg = t.segments.find((s) => tm >= s.start && tm <= s.end);
  const words = seg ? seg.text.split(" ").slice(0, 4).join(" ") : "";
  return `${tm}s ${words}`.trim();
}
