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
import { contentHash, fileHash } from "../media/hash.js";
import { offsetWords } from "../render/captions.js";
import { extractAudio, probeDuration, stitchAudio, trailingArtifactCut, trimAudio } from "../media/ffmpeg.js";
import { ttsWithTimestamps, ttsMockWithTimestamps, DEFAULT_SETTINGS, DEFAULT_VOICE_MODEL, modelSupportsContext } from "./elevenlabs.js";
import { transcribeAudio, scribeToWords } from "./scribe.js";
import { pickSttEngine, resolveWhisper, whisperTranscribe } from "./whisper.js";

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
  needClips?: boolean; // avatar providers need per-segment clips — forces the per-segment path
  resolveAsset?: (rel: string) => string; // project asset resolver for segment voFile paths
}

// ElevenLabs v3 audio tags ([excited], [short pause], …) are spoken direction, not caption copy —
// the alignment includes their characters, so drop tag tokens (from a [-starting word through the
// ]-ending word) before captions see them.
/** Mock words for an imported voFile: spec text paced evenly across the file's TRUE duration —
 *  free preview keeps honest beat lengths without any STT call. */
export function mockWordsForDuration(text: string, durationSec: number): WordTiming[] {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  const per = tokens.length ? durationSec / tokens.length : 0;
  return tokens.map((word, i) => ({
    word,
    start: Math.round(i * per * 1000) / 1000,
    end: Math.round((i + 1) * per * 1000) / 1000,
  }));
}

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
 * Exception: real faceless builds on models without previous_text/next_text support (v3) TTS the
 * whole script in ONE call instead — see buildVOSingle.
 * Contract: apiKey is required unless mock=true (real TTS calls pass it via the `apiKey!`
 * non-null assertion). Side effects: writes
 * into the Cache dir and a temp dir. Returns the stitched track path, per-clip paths, timings, and
 * timeline-absolute word timings.
 */
export async function buildVO({ spec, voiceId, cache, apiKey, mock, model, needClips, resolveAsset }: BuildVOOpts): Promise<VOResult> {
  const resolvedModel = model ?? DEFAULT_VOICE_MODEL;
  const hasVoFiles = spec.segments.some((s) => s.voFile);
  if (!mock && !needClips && !hasVoFiles && !modelSupportsContext(resolvedModel)) {
    return buildVOSingle(spec, voiceId, cache, apiKey!, resolvedModel);
  }
  const dir = mkdtempSync(join(tmpdir(), "kino-vo-"));
  const clips: string[] = [];
  const clipWords: WordTiming[][] = []; // clip-relative, offset to the timeline after timings are known
  const useCtx = modelSupportsContext(resolvedModel);
  for (const [i, seg] of spec.segments.entries()) {
    // Imported real VO: the file IS the clip. Mock paces spec text over the true duration (free,
    // offline); real builds transcribe once (Scribe with a key, else local whisper.cpp; KINO_STT
    // forces either) and cache the words by file content.
    if (seg.voFile) {
      const abs = resolveAsset ? resolveAsset(seg.voFile) : seg.voFile;
      clips.push(abs);
      if (mock) {
        clipWords.push(mockWordsForDuration(seg.text, await probeDuration(abs)));
      } else {
        const engine = pickSttEngine({
          hasKey: !!apiKey,
          hasWhisper: resolveWhisper() != null,
          override: process.env.KINO_STT,
        });
        const key = contentHash({ voSha: fileHash(abs), engine, v: "vofile-stt" });
        let wordsFile = cache.get(key, "json");
        if (!wordsFile) {
          const wav = join(dir, `vofile${i}.wav`);
          await extractAudio(abs, wav);
          const words =
            engine === "scribe"
              ? scribeToWords(await transcribeAudio(apiKey!, wav))
              : await whisperTranscribe(wav, join(dir, `vofile${i}`));
          if (!words.length) throw new Error(`segment[${i}] voFile ${seg.voFile}: transcription found no words`);
          const tmpJson = join(dir, `vofile${i}.json`);
          writeFileSync(tmpJson, JSON.stringify(words));
          wordsFile = cache.put(key, "json", tmpJson);
        }
        clipWords.push(JSON.parse(readFileSync(wordsFile, "utf8")) as WordTiming[]);
      }
      continue;
    }
    // Neighbor text is sent as previous_text/next_text so ElevenLabs keeps prosody continuous
    // across segment seams (v2-family models only — v3 rejects it, so v3 keys stay context-free
    // and existing v3 caches keep hitting). When sent, it's part of the cache key: editing one
    // segment re-bills its neighbors too (their clips were conditioned on the old text).
    const prev = useCtx ? spec.segments[i - 1]?.text : undefined;
    const next = useCtx ? spec.segments[i + 1]?.text : undefined;
    // `dur` only bites when silent (mock): it forces the beat length instead of the 0.38s/word
    // estimate. It's in the key so editing dur re-bakes the silent clip; harmless on real TTS.
    const key = contentHash({
      text: seg.text,
      ...(useCtx ? { prev, next } : {}),
      voiceId,
      settings: DEFAULT_SETTINGS,
      mock,
      dur: mock ? seg.dur ?? null : null,
      v: "ts",
      model: resolvedModel,
    });
    let clip = cache.get(key, "mp3");
    let wordsFile = cache.get(key, "json");
    if (!clip || !wordsFile) {
      const tmp = join(dir, `seg${i}.mp3`);
      const words = stripTagWords(
        mock
          ? await ttsMockWithTimestamps(seg.text, tmp, seg.dur)
          : await ttsWithTimestamps(apiKey!, voiceId, seg.text, tmp, DEFAULT_SETTINGS, resolvedModel, { previousText: prev, nextText: next }),
      );
      clip = cache.put(key, "mp3", tmp);
      const tmpJson = join(dir, `seg${i}.json`);
      writeFileSync(tmpJson, JSON.stringify(words));
      wordsFile = cache.put(key, "json", tmpJson);
    }
    clips.push(clip);
    clipWords.push(JSON.parse(readFileSync(wordsFile, "utf8")) as WordTiming[]);
  }
  // Trim each clip to its true speech end so beats don't end on an ElevenLabs trailing burst (see
  // trailingArtifactCut). Trimmed to lossless temp wav used for durations + the stitched track only;
  // the raw cached clips are returned/hashed untouched, so the cache (and the avatar track that keys
  // off vo.clips) stays stable, and stitchAudio re-encodes to mp3 exactly once.
  const cleanClips = await Promise.all(
    clips.map(async (c, i) => {
      // trailingArtifactCut is an ElevenLabs-artifact heuristic — never trim user-imported voFiles.
      const cut = mock || spec.segments[i].voFile ? null : await trailingArtifactCut(c);
      if (cut == null) return c;
      const t = join(dir, `clean${i}.wav`);
      await trimAudio(c, cut, t);
      return t;
    }),
  );
  const durations = await Promise.all(cleanClips.map(probeDuration));
  const timings = computeTimings(durations, GAP);
  const words = clipWords.map((w, i) => offsetWords(w, timings[i].startSec));
  // stitch marker: bump when seam handling (declick fade / trailing-artifact trim) changes so old
  // clicky tracks re-stitch. Hashes the raw clips (deterministic trim) so the key stays stable.
  const trackKey = contentHash({ clips, GAP, stitch: "fade8-trim1" });
  let track = cache.get(trackKey, "mp3");
  if (!track) {
    const tmp = join(dir, "track.mp3");
    await stitchAudio(cleanClips, GAP, tmp);
    track = cache.put(trackKey, "mp3", tmp);
  }
  return { trackPath: track, clips, timings, words, totalSec: timings.at(-1)!.endSec };
}

/**
 * Split the whole-script word timings back into per-segment arrays by consuming each segment's
 * whitespace token count in order. Relies on the alignment echoing the input tokens (it mirrors
 * the request text char-for-char); throws loudly on a count mismatch rather than desyncing captions.
 */
export function splitWordsBySegment(texts: string[], allWords: WordTiming[]): WordTiming[][] {
  let off = 0;
  const out = texts.map((t) => {
    const n = t.trim().split(/\s+/).length;
    const slice = allWords.slice(off, off + n);
    off += n;
    return slice;
  });
  if (off !== allWords.length) {
    throw new Error(`VO single-call word mismatch: spec has ${off} words, alignment returned ${allWords.length}`);
  }
  return out;
}

// Real faceless builds on models that reject previous_text/next_text (v3): per-segment calls
// can't be prosody-conditioned, so TTS the whole script in ONE call — the read flows naturally
// across beats — then derive per-segment timings/words from the single alignment.
// Segment startSec = its first word's start (0 for the opener); endSec = its last word's end
// (track duration for the closer, so the natural decay isn't cut). Inter-beat gaps are whatever
// pause the model produced, not GAP.
// Tradeoff (accepted): one cache entry for the whole script — editing any segment re-bills the
// entire VO. Avatar providers need per-segment clips, so they stay on the per-segment path.
async function buildVOSingle(spec: Spec, voiceId: string, cache: Cache, apiKey: string, model: string): Promise<VOResult> {
  const texts = spec.segments.map((s) => s.text);
  const key = contentHash({ texts, voiceId, settings: DEFAULT_SETTINGS, v: "single", model });
  let track = cache.get(key, "mp3");
  let metaFile = cache.get(key, "json");
  if (!track || !metaFile) {
    const dir = mkdtempSync(join(tmpdir(), "kino-vo-"));
    const tmp = join(dir, "track.mp3");
    const allWords = await ttsWithTimestamps(apiKey, voiceId, texts.join("\n\n"), tmp, DEFAULT_SETTINGS, model);
    const raw = splitWordsBySegment(texts, allWords);
    const dur = await probeDuration(tmp);
    const timings: SegmentTiming[] = raw.map((w, i) => {
      const start = i === 0 ? 0 : w[0].start;
      const end = i === raw.length - 1 ? dur : w.at(-1)!.end;
      return { index: i, startSec: round2(start), endSec: round2(end), durSec: round2(end - start) };
    });
    const tmpJson = join(dir, "meta.json");
    writeFileSync(tmpJson, JSON.stringify({ timings, words: raw.map(stripTagWords) }));
    track = cache.put(key, "mp3", tmp);
    metaFile = cache.put(key, "json", tmpJson);
  }
  const meta = JSON.parse(readFileSync(metaFile, "utf8")) as { timings: SegmentTiming[]; words: WordTiming[][] };
  return { trackPath: track, clips: [], timings: meta.timings, words: meta.words, totalSec: meta.timings.at(-1)!.endSec };
}
