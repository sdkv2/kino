import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Spec } from "../spec/schema.js";
import type { SegmentTiming, VOResult } from "../types.js";
import type { WordTiming } from "../render/props.js";
import type { Cache } from "../media/cache.js";
import { contentHash } from "../media/hash.js";
import { offsetWords } from "../render/captions.js";
import { probeDuration, stitchAudio } from "../media/ffmpeg.js";
import { ttsWithTimestamps, ttsMockWithTimestamps, DEFAULT_SETTINGS } from "./elevenlabs.js";

export const GAP = 0.32;

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
  const clipWords: WordTiming[][] = []; // clip-relative, offset to the timeline after timings are known
  for (const [i, seg] of spec.segments.entries()) {
    const key = contentHash({ text: seg.text, voiceId, settings: DEFAULT_SETTINGS, mock, v: "ts" });
    let clip = cache.get(key, "mp3");
    let wordsFile = cache.get(key, "json");
    if (!clip || !wordsFile) {
      const tmp = join(dir, `seg${i}.mp3`);
      const words = mock ? await ttsMockWithTimestamps(seg.text, tmp) : await ttsWithTimestamps(apiKey!, voiceId, seg.text, tmp);
      clip = cache.put(key, "mp3", tmp);
      const tmpJson = join(dir, `seg${i}.json`);
      writeFileSync(tmpJson, JSON.stringify(words));
      wordsFile = cache.put(key, "json", tmpJson);
    }
    clips.push(clip);
    clipWords.push(JSON.parse(readFileSync(wordsFile, "utf8")) as WordTiming[]);
  }
  const durations = await Promise.all(clips.map(probeDuration));
  const timings = computeTimings(durations, GAP);
  const words = clipWords.map((w, i) => offsetWords(w, timings[i].startSec));
  const trackKey = contentHash({ clips, GAP });
  let track = cache.get(trackKey, "mp3");
  if (!track) {
    const tmp = join(dir, "track.mp3");
    await stitchAudio(clips, GAP, tmp);
    track = cache.put(trackKey, "mp3", tmp);
  }
  return { trackPath: track, clips, timings, words, totalSec: timings.at(-1)!.endSec };
}
