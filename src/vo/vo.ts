// VO orchestration: turns spec.segments into a stitched voiceover track + per-word timings.
// Each segment is TTS'd (or mocked) and content-hash cached (mp3 + json), then the clips are
// concatenated with a fixed inter-segment GAP into one continuous track. Pure orchestration —
// no avatar/render concerns. Public API: buildVO() → VOResult.
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
import { ttsWithTimestamps, ttsMockWithTimestamps, DEFAULT_SETTINGS, DEFAULT_VOICE_MODEL } from "./elevenlabs.js";

// Seconds of silence inserted between segments in the stitched track. Also part of the track
// cache key (contentHash({clips, GAP})) — changing it re-stitches but does not re-bill TTS.
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
  model?: string; // TTS model_id; default DEFAULT_VOICE_MODEL (eleven_v3)
}

// ElevenLabs v3 audio tags ([excited], [short pause], …) are spoken direction, not caption copy —
// the alignment includes their characters, so drop tag tokens (from a [-starting word through the
// ]-ending word) before captions see them.
export function stripTagWords(words: WordTiming[]): WordTiming[] {
  const out: WordTiming[] = [];
  let inTag = false;
  for (const w of words) {
    if (!inTag && w.word.startsWith("[")) inTag = true;
    if (!inTag) out.push(w);
    if (inTag && w.word.endsWith("]")) inTag = false;
  }
  return out;
}

/**
 * Build the voiceover for a spec. Per segment: reuse the cached mp3+json if present, else TTS
 * (real ElevenLabs when !mock, silence+fake timings when mock) and cache the result. Then probe
 * durations, compute timeline timings with GAP, offset clip-relative word times onto the timeline,
 * and stitch one continuous track (also cached).
 * Contract: apiKey is required unless mock=true (real TTS calls pass it via the `apiKey!`
 * non-null assertion). Side effects: writes
 * into the Cache dir and a temp dir. Returns the stitched track path, per-clip paths, timings, and
 * timeline-absolute word timings.
 */
export async function buildVO({ spec, voiceId, cache, apiKey, mock, model }: BuildVOOpts): Promise<VOResult> {
  const dir = mkdtempSync(join(tmpdir(), "kino-vo-"));
  const clips: string[] = [];
  const clipWords: WordTiming[][] = []; // clip-relative, offset to the timeline after timings are known
  const resolvedModel = model ?? DEFAULT_VOICE_MODEL;
  for (const [i, seg] of spec.segments.entries()) {
    const key = contentHash({ text: seg.text, voiceId, settings: DEFAULT_SETTINGS, mock, v: "ts", model: resolvedModel });
    let clip = cache.get(key, "mp3");
    let wordsFile = cache.get(key, "json");
    if (!clip || !wordsFile) {
      const tmp = join(dir, `seg${i}.mp3`);
      const words = stripTagWords(
        mock ? await ttsMockWithTimestamps(seg.text, tmp) : await ttsWithTimestamps(apiKey!, voiceId, seg.text, tmp, DEFAULT_SETTINGS, resolvedModel),
      );
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
