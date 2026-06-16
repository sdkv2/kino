# kino video inspection — design

**Date:** 2026-06-16
**Status:** approved (brainstorm) → ready for plan
**Branch:** `feat/video-inspection`

## Goal

Let an agent point kino at **any** video (not just kino-rendered output) and "watch" it
through text + stills:

1. **Transcribe** the audio to a timestamped transcript — know *what is said where*
   (word-level and segment-level start/end times).
2. **Extract frames** at chosen or auto-spaced timestamps — see *what is on screen*.

This is **read-only inspection**. It does not write a new video, burn in captions, or emit a
kino spec — those are explicitly out of scope (see below).

## Intended use (agent guidance — must be prominent in the docs)

These commands exist **purely to analyse *other people's* videos** — competitor ads, trending /
reference clips (e.g. what `using-spider` downloads), inspiration the agent is studying. They are a
**research tool, not a production step.**

**Use it when:** studying an external/downloaded clip — "what does this competitor ad say and
show?", pulling hooks/pacing/structure from a trending video, building a swipe file.

**Do NOT use it for:**

- **kino's own rendered output.** kino already has exact word timings from the TTS
  `…/with-timestamps` step — re-transcribing a clip we generated is wasteful and lossy. To inspect
  our own renders, use `kino inspect` (plan + word times) and `kino frames`/`still`.
- **Any part of the build/production pipeline.** `transcribe`/`scan` must never be wired into
  `build`, caption generation, or spec authoring. They are read-only side tools.
- **Transcribing the user's private/unrelated media** as a general utility. Scope is marketing
  research on reference videos.

This guidance is **load-bearing**: it ships verbatim in the agent-facing docs (`SKILL.md` +
`reference.md`) and in each command's `--help` description, so an agent reaching for the wrong tool
is corrected at the point of use. Every command description leads with "analyse an external
reference video".

## Provider

Speech-to-text uses **ElevenLabs Scribe** (`POST /v1/speech-to-text`, `model_id: scribe_v1`):

- Same `ELEVENLABS_API_KEY` already used for the TTS voiceover pipeline — no new credential.
- Returns word-level timestamps natively, which is exactly what "see what words are said where"
  needs.
- Cost ≈ $0.40 per hour of audio.

Whisper / local STT were considered and rejected: they add a second credential or a heavy local
install for no benefit here.

## Command surface

Composable primitives plus one thin convenience wrapper.

### `kino transcribe <video> [--format json|srt|vtt|text] [--out <file>] [--mock]` (new — core)

1. Extract a mono 16 kHz WAV from the input with ffmpeg (`-vn -ac 1 -ar 16000`).
2. Send the WAV to Scribe.
3. Map the response into a `Transcript` (below) and emit it.

- `--format json` (default) prints the machine-readable transcript to stdout.
- `--format srt|vtt` prints subtitle formats; `--format text` prints plain text.
- `--out <file>` writes to a file instead of stdout (extension is informational; `--format`
  decides the content).
- `--mock` skips ffmpeg + network and produces evenly-spaced fake words (offline, $0, for tests),
  mirroring the existing `ttsMock*` helpers.
- Result is cached by a content hash of `{ audio bytes, model }`, so a repeat transcription of the
  same clip is free (consistent with kino's existing VO/avatar caching).

### `kino frames <video>` (extend existing)

Add two ways to choose timestamps when the agent does not already know them, keeping `--at` and
`--montage`:

- `--every <sec>` — a frame every N seconds across the clip.
- `--count <n>` — N frames spaced evenly across the clip.

Precedence is `--at` > `--count` > `--every` (the most explicit selection wins). When
`--every`/`--count` are used, the clip duration comes from `probeDuration`.

### `kino scan <video> [--count <n>] [--every <sec>] [--out <dir>]` (new — thin wrapper)

One call that gives an agent everything to "view" a clip:

1. `transcribe` the video → write `transcript.json` into the out dir.
2. Extract frames — one per transcript **segment** by default (frame at each segment's midpoint),
   or evenly via `--count`/`--every`.
3. Build a labeled `montage` contact sheet (label = segment time + first words).

Output dir defaults to `<video-dir>/<video-basename>-scan/`. `scan` is intentionally thin (it
orchestrates `transcribe` + `frames` + `montage`); if it proves redundant it can be dropped without
touching the primitives.

## Data structures

Reuses the existing `WordTiming { word, start, end }` from `render/props.ts`.

```ts
interface TranscriptSegment { text: string; start: number; end: number; words: WordTiming[]; }
interface Transcript {
  text: string;              // full transcript text
  durationSec: number;       // probed audio duration
  language?: string;         // Scribe language_code, when present
  words: WordTiming[];       // flat word list, absolute times
  segments: TranscriptSegment[]; // words grouped into lines/sentences
}
```

## Data flow

```
video
  → ffmpeg  (-vn -ac 1 -ar 16000 → wav)        [media/ffmpeg.ts: extractAudio]
  → Scribe  (POST /v1/speech-to-text)          [vo/scribe.ts: transcribeAudio]
  → words[] (filter response type === "word")  [vo/scribe.ts: scribeToWords]
  → segments[] (group by sentence punctuation / pause gap > threshold)  [render/transcript.ts]
  → emit json | srt | vtt | text               [render/transcript.ts formatters]
```

## Module boundaries (small, single-purpose, testable)

- `media/ffmpeg.ts` — add `extractAudio(video, out)` (mono 16 kHz WAV via ffmpeg).
- `vo/scribe.ts` — `transcribeAudio(apiKey, wavPath): RawScribe` (network) and the **pure**
  `scribeToWords(raw): WordTiming[]` mapping (filter `type === "word"`, map `text/start/end`).
- `render/transcript.ts` — **pure**: `groupWordsIntoSegments(words, opts)`, `wordsToSrt`,
  `wordsToVtt`, `wordsToText`, and a `buildTranscript(words, durationSec, language?)` assembler.
- `commands/transcribe.ts` — orchestrates extract → transcribe (or mock) → format/emit; handles
  caching.
- `commands/frames.ts` — add **pure** `pickIntervalTimes(durationSec, { every?, count? })`; wire
  the new flags.
- `commands/scan.ts` — orchestrates transcribe + frames + montage.
- `cli.ts` — register `transcribe`, `scan`; add `--every`/`--count` to `frames`.

## Segment grouping rules

`groupWordsIntoSegments(words, { maxGapSec = 0.6, sentenceEnders = /[.!?]$/ })`:

- Start a new segment after a word whose text ends in `.`, `!`, or `?`.
- Also start a new segment when the gap between a word's end and the next word's start exceeds
  `maxGapSec` (a pause).
- A segment's `start` = its first word's start; `end` = its last word's end; `text` = the words
  joined by spaces.
- Empty input → `[]`.

## Error handling

- Missing `ELEVENLABS_API_KEY` → throw the existing-style clear message pointing at `.env`.
- Input video has **no audio stream** → ffmpeg produces an empty/zero-duration WAV; detect via
  `probeDuration` ≈ 0 (or no words returned) and report `"<video> has no audible speech / audio
  track"` rather than emitting an empty transcript silently.
- Scribe non-2xx → throw `Scribe <status>: <body>` (mirrors the ElevenLabs TTS error style).
- `frames`/`scan` with neither `--at` nor `--every`/`--count`: `frames` keeps its current
  "needs --at" behavior; `scan` defaults to one frame per segment.

## Caching

`transcribe` keys on `contentHash({ kind: "scribe", model: "scribe_v1", size: <wav bytes> })`
using the existing `media/cache.ts`, storing the transcript JSON. Mock runs are not cached
(deterministic + free).

## Testing (TDD)

Pure helpers first, each with focused unit tests:

- `groupWordsIntoSegments` — splits on sentence enders and on pause gaps; single segment when
  neither; empty input → `[]`.
- `wordsToSrt` / `wordsToVtt` — correct index/timecodes (`HH:MM:SS,mmm` vs `HH:MM:SS.mmm`) and
  cue text; `wordsToText` — plain joined text.
- `scribeToWords` — filters non-word tokens (spacing), maps fields.
- `pickIntervalTimes` — `--count` spacing and `--every` spacing across a known duration; clamps to
  the clip.

Integration:

- `transcribe --mock <anything>` — emits a well-formed JSON transcript offline (no ffmpeg/network),
  asserting words + segments are present and times are monotonic.
- `scan --mock` — produces `transcript.json` + at least one frame + a montage file.

ffmpeg-touching helpers (`extractAudio`) follow the existing `tests/ffmpeg.test.ts` pattern
(generate a known input, run, probe the result).

## Out of scope (deferred)

- Burning kino-style captions onto an arbitrary input video.
- Emitting an editable kino spec from a transcript.
- Speaker diarization / multi-speaker labels (Scribe can return `speaker_id`; we ignore it for now).
- Scene-change-based frame selection (interval/segment selection only).

## Docs to update on completion

- `skills/video-production/SKILL.md` + `reference.md` — new commands **and** the "Intended use"
  guidance above (a clearly-headed section: research-only, not for our own renders, not in the
  pipeline). This is a required deliverable, not an afterthought.
- Each command's `commander` description (`--help`) leads with "analyse an external reference
  video".
- `README.md` status line; version bump.
