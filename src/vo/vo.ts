import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Spec } from "../spec/schema.js";
import type { SegmentTiming, VOResult } from "../types.js";
import type { Cache } from "../media/cache.js";
import { contentHash } from "../media/hash.js";
import { probeDuration, stitchAudio } from "../media/ffmpeg.js";
import { tts, ttsMock, DEFAULT_SETTINGS } from "./elevenlabs.js";

const GAP = 0.32;

export function computeTimings(durations: number[], gap: number): SegmentTiming[] {
  const out: SegmentTiming[] = [];
  let t = 0;
  durations.forEach((d, i) => {
    out.push({ index: i, startSec: round2(t), endSec: round2(t + d), durSec: round2(d) });
    t += d + gap;
  });
  return out;
}
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface BuildVOOpts {
  spec: Spec;
  voiceId: string;
  cache: Cache;
  apiKey?: string;
  mock: boolean;
}

export async function buildVO({ spec, voiceId, cache, apiKey, mock }: BuildVOOpts): Promise<VOResult> {
  const dir = mkdtempSync(join(tmpdir(), "kino-vo-"));
  const clips: string[] = [];
  for (const [i, seg] of spec.segments.entries()) {
    const key = contentHash({ text: seg.text, voiceId, settings: DEFAULT_SETTINGS, mock });
    let clip = cache.get(key, "mp3");
    if (!clip) {
      const tmp = join(dir, `seg${i}.mp3`);
      if (mock) await ttsMock(seg.text, tmp);
      else await tts(apiKey!, voiceId, seg.text, tmp);
      clip = cache.put(key, "mp3", tmp);
    }
    clips.push(clip);
  }
  const durations = await Promise.all(clips.map(probeDuration));
  const timings = computeTimings(durations, GAP);
  const trackKey = contentHash({ clips, GAP });
  let track = cache.get(trackKey, "mp3");
  if (!track) {
    const tmp = join(dir, "track.mp3");
    await stitchAudio(clips, GAP, tmp);
    track = cache.put(trackKey, "mp3", tmp);
  }
  return { trackPath: track, timings, totalSec: timings.at(-1)!.endSec };
}
