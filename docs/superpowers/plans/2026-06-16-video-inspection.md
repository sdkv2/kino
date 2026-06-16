# kino Video Inspection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an agent kino commands to analyse *external reference videos* (competitor/trending clips) — transcribe speech to a timestamped transcript and extract frames — without touching the production pipeline.

**Architecture:** A new `transcribe` command extracts audio (ffmpeg) and calls ElevenLabs Scribe STT, mapping the result through pure helpers into a `Transcript` (words + segments). The existing `frames` command gains interval-based selection, and a thin `scan` wrapper composes transcribe + frames + montage. All speech-to-text logic sits behind small pure functions that are unit-tested; network/ffmpeg calls are thin and covered by a `--mock` path.

**Tech Stack:** TypeScript (ESM, Node 25), commander, execa + ffmpeg/ffprobe, ElevenLabs Scribe (`/v1/speech-to-text`), vitest. Reuses `media/cache.ts`, `media/hash.ts`, `media/net.ts`, `config/{env,project}.ts`, `render/props.ts` (`WordTiming`).

**Spec:** `docs/superpowers/specs/2026-06-16-video-inspection-design.md`

---

## File Structure

- `src/media/ffmpeg.ts` *(modify)* — add `extractAudio(video, out)` and `extractFrame(video, sec, out)`.
- `src/vo/scribe.ts` *(create)* — `transcribeAudio` (network) + `scribeToWords` (pure mapping).
- `src/render/transcript.ts` *(create)* — pure: `groupWordsIntoSegments`, `buildTranscript`, `wordsToSrt`, `wordsToVtt`, `wordsToText`, `fmtTimecode`; types `TranscriptSegment`, `Transcript`.
- `src/render/preview.ts` *(modify)* — add pure `pickIntervalTimes(durationSec, {count?, every?})`.
- `src/commands/transcribe.ts` *(create)* — orchestrate extract → Scribe (or mock) → emit; cache.
- `src/commands/frames.ts` *(modify)* — wire `--every`/`--count` via `pickIntervalTimes`; use `extractFrame`.
- `src/commands/scan.ts` *(create)* — transcribe + per-segment frames + montage.
- `src/cli.ts` *(modify)* — register `transcribe`, `scan`; add flags to `frames`; bump version.
- Tests: `tests/{scribe,transcript,transcribe-mock}.test.ts` *(create)*; `tests/{ffmpeg,preview}.test.ts` *(modify)*.
- Docs: `skills/video-production/{SKILL.md,reference.md}`, `README.md`, `package.json` *(modify)*.

---

## Task 1: ffmpeg helpers (extractAudio, extractFrame)

**Files:**
- Modify: `src/media/ffmpeg.ts`
- Test: `tests/ffmpeg.test.ts`

- [ ] **Step 1: Write the failing tests** — append inside the `describe("ffmpeg helpers", …)` block in `tests/ffmpeg.test.ts`:

```ts
  it("extracts a mono wav from a video with audio", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-xa-"));
    const v = join(dir, "v.mp4");
    const wav = join(dir, "a.wav");
    // a 2s clip that actually has an audio stream
    await execa("ffmpeg", ["-y", "-loglevel", "error",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
      "-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=30",
      "-pix_fmt", "yuv420p", "-shortest", v]);
    await extractAudio(v, wav);
    expect(await probeDuration(wav)).toBeCloseTo(2.0, 1);
  });

  it("extracts a single frame at a timestamp", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-xf-"));
    const v = join(dir, "v.mp4");
    const png = join(dir, "f.png");
    await execa("ffmpeg", ["-y", "-loglevel", "error",
      "-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=30", "-pix_fmt", "yuv420p", v]);
    await extractFrame(v, 1.0, png);
    expect(existsSync(png)).toBe(true);
  });
```

Add the imports at the top of the test file (merge with the existing import lines):

```ts
import { genSilence, probeDuration, stitchAudio, extractAudio, extractFrame } from "../src/media/ffmpeg.js";
import { execa } from "execa";
import { mkdtempSync, existsSync } from "node:fs";
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ~/kino && npx vitest run tests/ffmpeg.test.ts`
Expected: FAIL — `extractAudio`/`extractFrame` are not exported.

- [ ] **Step 3: Implement the helpers** — append to `src/media/ffmpeg.ts`:

```ts
// Pull a mono 16 kHz WAV out of a video (for speech-to-text). No video stream in the output.
export async function extractAudio(video: string, out: string): Promise<void> {
  await execa("ffmpeg", ["-y", "-loglevel", "error", "-i", video, "-vn", "-ac", "1", "-ar", "16000", out]);
}

// Grab one frame at `sec` seconds.
export async function extractFrame(video: string, sec: number, out: string): Promise<void> {
  await execa("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(sec), "-i", video, "-frames:v", "1", out]);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/kino && npx vitest run tests/ffmpeg.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/kino && git add src/media/ffmpeg.ts tests/ffmpeg.test.ts
git commit -m "feat: extractAudio + extractFrame ffmpeg helpers"
```

---

## Task 2: scribeToWords (pure response mapping)

**Files:**
- Create: `src/vo/scribe.ts`
- Test: `tests/scribe.test.ts`

- [ ] **Step 1: Write the failing test** — create `tests/scribe.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { scribeToWords } from "../src/vo/scribe.js";

describe("scribeToWords", () => {
  it("keeps only word tokens and maps text/start/end", () => {
    const raw = {
      text: "hi there",
      words: [
        { text: "hi", start: 0.0, end: 0.4, type: "word" },
        { text: " ", start: 0.4, end: 0.5, type: "spacing" },
        { text: "there", start: 0.5, end: 0.9, type: "word" },
      ],
    };
    expect(scribeToWords(raw)).toEqual([
      { word: "hi", start: 0.0, end: 0.4 },
      { word: "there", start: 0.5, end: 0.9 },
    ]);
  });
  it("treats a missing type as a word and tolerates no words array", () => {
    expect(scribeToWords({ words: [{ text: "x", start: 0, end: 1 }] })).toEqual([{ word: "x", start: 0, end: 1 }]);
    expect(scribeToWords({ words: undefined as unknown as [] })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/kino && npx vitest run tests/scribe.test.ts`
Expected: FAIL — cannot find `../src/vo/scribe.js`.

- [ ] **Step 3: Implement** — create `src/vo/scribe.ts`:

```ts
// ElevenLabs Scribe speech-to-text. Verified shape:
//   POST /v1/speech-to-text  (multipart: file, model_id=scribe_v1)  → { text, language_code, words[] }
//   each word: { text, start, end, type: "word" | "spacing" | "audio_event" }
// Used ONLY to analyse external reference videos (see commands/transcribe.ts header).
import { filePart, fileName } from "../media/net.js";
import type { WordTiming } from "../render/props.js";

const BASE = "https://api.elevenlabs.io/v1";

export interface ScribeToken { text: string; start: number; end: number; type?: string }
export interface RawScribe { text?: string; language_code?: string; words: ScribeToken[] }

// Pure: drop spacing/audio-event tokens, keep real words as timeline WordTimings.
export function scribeToWords(raw: RawScribe): WordTiming[] {
  return (raw.words ?? [])
    .filter((w) => (w.type ?? "word") === "word")
    .map((w) => ({ word: w.text, start: w.start, end: w.end }));
}

export async function transcribeAudio(apiKey: string, audioPath: string): Promise<RawScribe> {
  const fd = new FormData();
  fd.append("file", await filePart(audioPath), fileName(audioPath));
  fd.append("model_id", "scribe_v1");
  const r = await fetch(`${BASE}/speech-to-text`, { method: "POST", headers: { "xi-api-key": apiKey }, body: fd });
  if (!r.ok) throw new Error(`Scribe ${r.status}: ${await r.text()}`);
  return (await r.json()) as RawScribe;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/kino && npx vitest run tests/scribe.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/kino && git add src/vo/scribe.ts tests/scribe.test.ts
git commit -m "feat: Scribe STT client + pure scribeToWords mapping"
```

---

## Task 3: transcript segment grouping (pure)

**Files:**
- Create: `src/render/transcript.ts`
- Test: `tests/transcript.test.ts`

- [ ] **Step 1: Write the failing test** — create `tests/transcript.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { groupWordsIntoSegments } from "../src/render/transcript.js";

const W = (word: string, start: number, end: number) => ({ word, start, end });

describe("groupWordsIntoSegments", () => {
  it("returns [] for no words", () => {
    expect(groupWordsIntoSegments([])).toEqual([]);
  });
  it("splits on sentence-ending punctuation", () => {
    const segs = groupWordsIntoSegments([W("Hi", 0, 0.3), W("there.", 0.3, 0.7), W("Bye", 0.8, 1.1)]);
    expect(segs.map((s) => s.text)).toEqual(["Hi there.", "Bye"]);
    expect(segs[0]).toMatchObject({ start: 0, end: 0.7 });
  });
  it("splits on a pause gap larger than maxGapSec", () => {
    const segs = groupWordsIntoSegments([W("a", 0, 0.3), W("b", 2.0, 2.3)], { maxGapSec: 0.6 });
    expect(segs.map((s) => s.text)).toEqual(["a", "b"]);
  });
  it("keeps a single segment when no break occurs", () => {
    const segs = groupWordsIntoSegments([W("one", 0, 0.3), W("two", 0.3, 0.6)]);
    expect(segs).toHaveLength(1);
    expect(segs[0].words).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/kino && npx vitest run tests/transcript.test.ts`
Expected: FAIL — cannot find `../src/render/transcript.js`.

- [ ] **Step 3: Implement** — create `src/render/transcript.ts`:

```ts
import type { WordTiming } from "./props.js";

export interface TranscriptSegment { text: string; start: number; end: number; words: WordTiming[] }
export interface Transcript {
  text: string;
  durationSec: number;
  language?: string;
  words: WordTiming[];
  segments: TranscriptSegment[];
}

// Group flat word timings into lines: break after sentence-ending punctuation, or on a pause
// (gap from the previous word's end to this word's start) longer than maxGapSec.
export function groupWordsIntoSegments(words: WordTiming[], opts: { maxGapSec?: number } = {}): TranscriptSegment[] {
  const maxGap = opts.maxGapSec ?? 0.6;
  const segs: TranscriptSegment[] = [];
  let cur: WordTiming[] = [];
  const flush = () => {
    if (!cur.length) return;
    segs.push({ text: cur.map((w) => w.word).join(" "), start: cur[0].start, end: cur[cur.length - 1].end, words: cur });
    cur = [];
  };
  for (const w of words) {
    if (cur.length && w.start - cur[cur.length - 1].end > maxGap) flush();
    cur.push(w);
    if (/[.!?]$/.test(w.word)) flush();
  }
  flush();
  return segs;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/kino && npx vitest run tests/transcript.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/kino && git add src/render/transcript.ts tests/transcript.test.ts
git commit -m "feat: groupWordsIntoSegments transcript helper"
```

---

## Task 4: transcript formatters + assembler (pure)

**Files:**
- Modify: `src/render/transcript.ts`
- Test: `tests/transcript.test.ts`

- [ ] **Step 1: Write the failing tests** — append to `tests/transcript.test.ts`:

```ts
import { buildTranscript, wordsToSrt, wordsToVtt, wordsToText, fmtTimecode } from "../src/render/transcript.js";

describe("fmtTimecode", () => {
  it("formats HH:MM:SS with the given millisecond separator", () => {
    expect(fmtTimecode(3661.5, ",")).toBe("01:01:01,500");
    expect(fmtTimecode(3661.5, ".")).toBe("01:01:01.500");
  });
});

describe("buildTranscript", () => {
  it("assembles text, duration, words and segments", () => {
    const words = [W("Hi", 0, 0.3), W("there.", 0.3, 0.7)];
    const t = buildTranscript(words, { durationSec: 0.7, fullText: "Hi there." });
    expect(t).toMatchObject({ text: "Hi there.", durationSec: 0.7 });
    expect(t.segments).toHaveLength(1);
    expect(t.words).toHaveLength(2);
  });
  it("falls back to joined words when no fullText is given", () => {
    expect(buildTranscript([W("a", 0, 1)], { durationSec: 1 }).text).toBe("a");
  });
});

describe("subtitle formatters", () => {
  const segs = groupWordsIntoSegments([W("Hi", 0, 0.5), W("there.", 0.5, 1.0)]);
  it("wordsToSrt numbers cues with comma millis", () => {
    expect(wordsToSrt(segs)).toBe("1\n00:00:00,000 --> 00:00:01,000\nHi there.\n");
  });
  it("wordsToVtt starts with WEBVTT and uses dot millis", () => {
    expect(wordsToVtt(segs)).toBe("WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHi there.\n");
  });
  it("wordsToText joins segment text by newline", () => {
    expect(wordsToText(segs)).toBe("Hi there.\n");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ~/kino && npx vitest run tests/transcript.test.ts`
Expected: FAIL — `buildTranscript`/`wordsToSrt`/`wordsToVtt`/`wordsToText`/`fmtTimecode` not exported.

- [ ] **Step 3: Implement** — append to `src/render/transcript.ts`:

```ts
const pad = (n: number, len = 2) => String(n).padStart(len, "0");

// HH:MM:SS<sep>mmm — sep is "," for SRT, "." for VTT. Floor millis (no rollover).
export function fmtTimecode(sec: number, msSep: "," | "."): string {
  const ms = Math.floor((sec % 1) * 1000);
  const s = Math.floor(sec) % 60;
  const m = Math.floor(sec / 60) % 60;
  const h = Math.floor(sec / 3600);
  return `${pad(h)}:${pad(m)}:${pad(s)}${msSep}${pad(ms, 3)}`;
}

export function buildTranscript(
  words: WordTiming[],
  opts: { durationSec: number; language?: string; fullText?: string; maxGapSec?: number },
): Transcript {
  const segments = groupWordsIntoSegments(words, { maxGapSec: opts.maxGapSec });
  return {
    text: opts.fullText ?? words.map((w) => w.word).join(" "),
    durationSec: opts.durationSec,
    language: opts.language,
    words,
    segments,
  };
}

export function wordsToSrt(segments: TranscriptSegment[]): string {
  return segments
    .map((s, i) => `${i + 1}\n${fmtTimecode(s.start, ",")} --> ${fmtTimecode(s.end, ",")}\n${s.text}`)
    .join("\n\n") + "\n";
}

export function wordsToVtt(segments: TranscriptSegment[]): string {
  return "WEBVTT\n\n" + segments
    .map((s) => `${fmtTimecode(s.start, ".")} --> ${fmtTimecode(s.end, ".")}\n${s.text}`)
    .join("\n\n") + "\n";
}

export function wordsToText(segments: TranscriptSegment[]): string {
  return segments.map((s) => s.text).join("\n") + "\n";
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/kino && npx vitest run tests/transcript.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
cd ~/kino && git add src/render/transcript.ts tests/transcript.test.ts
git commit -m "feat: transcript assembler + SRT/VTT/text formatters"
```

---

## Task 5: pickIntervalTimes (pure frame selection)

**Files:**
- Modify: `src/render/preview.ts`
- Test: `tests/preview.test.ts`

- [ ] **Step 1: Write the failing test** — append to `tests/preview.test.ts` (add `pickIntervalTimes` to the existing import from `../src/render/preview.js`):

```ts
describe("pickIntervalTimes", () => {
  it("spaces N frames evenly, inset from both ends", () => {
    expect(pickIntervalTimes(10, { count: 4 })).toEqual([2, 4, 6, 8]);
  });
  it("count of 1 picks the midpoint", () => {
    expect(pickIntervalTimes(10, { count: 1 })).toEqual([5]);
  });
  it("--every steps across the clip, centred", () => {
    expect(pickIntervalTimes(10, { every: 2 })).toEqual([1, 3, 5, 7, 9]);
  });
  it("count wins when both count and every are given", () => {
    expect(pickIntervalTimes(10, { count: 2, every: 1 })).toEqual([10 / 3, 20 / 3].map((n) => Math.round(n * 100) / 100));
  });
  it("returns [] when neither is set", () => {
    expect(pickIntervalTimes(10, {})).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/kino && npx vitest run tests/preview.test.ts`
Expected: FAIL — `pickIntervalTimes` not exported.

- [ ] **Step 3: Implement** — append to `src/render/preview.ts` (reuses the existing module-level `round2`):

```ts
// Frame timestamps across a clip of known duration when the agent doesn't know exact times:
// `count` → N points spaced evenly and inset from both ends; `every` → one every N seconds,
// centred. Precedence count > every. Empty when neither is set.
export function pickIntervalTimes(durationSec: number, opts: { count?: number; every?: number }): number[] {
  if (opts.count && opts.count > 0) {
    const step = durationSec / (opts.count + 1);
    return Array.from({ length: opts.count }, (_, i) => round2(step * (i + 1)));
  }
  if (opts.every && opts.every > 0) {
    const out: number[] = [];
    for (let t = opts.every / 2; t < durationSec; t += opts.every) out.push(round2(t));
    return out.length ? out : [round2(durationSec / 2)];
  }
  return [];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/kino && npx vitest run tests/preview.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/kino && git add src/render/preview.ts tests/preview.test.ts
git commit -m "feat: pickIntervalTimes frame selection helper"
```

---

## Task 6: transcribe command (+ mock, cache, emit)

**Files:**
- Create: `src/commands/transcribe.ts`
- Test: `tests/transcribe-mock.test.ts`

- [ ] **Step 1: Write the failing test** — create `tests/transcribe-mock.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { transcribe } from "../src/commands/transcribe.js";

describe("transcribe --mock", () => {
  it("returns a well-formed transcript offline (no ffmpeg/network)", async () => {
    const t = await transcribe("does-not-exist.mp4", { mock: true });
    expect(t.words.length).toBeGreaterThan(0);
    expect(t.segments.length).toBe(2); // mock text has two sentences
    expect(t.text).toContain("mock");
    // monotonic word times
    for (let i = 1; i < t.words.length; i++) expect(t.words[i].start).toBeGreaterThanOrEqual(t.words[i - 1].start);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/kino && npx vitest run tests/transcribe-mock.test.ts`
Expected: FAIL — cannot find `../src/commands/transcribe.js`.

- [ ] **Step 3: Implement** — create `src/commands/transcribe.ts`:

```ts
import { mkdtempSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProject } from "../config/project.js";
import { loadEnv, requireKey } from "../config/env.js";
import { Cache } from "../media/cache.js";
import { contentHash } from "../media/hash.js";
import { probeDuration, extractAudio } from "../media/ffmpeg.js";
import { transcribeAudio, scribeToWords } from "../vo/scribe.js";
import { buildTranscript, wordsToSrt, wordsToVtt, wordsToText, type Transcript } from "../render/transcript.js";
import { log } from "../log.js";

const round2 = (n: number) => Math.round(n * 100) / 100;
const MOCK_TEXT = "This is a mock transcript. It has two segments.";

// IMPORTANT: `transcribe` and `scan` are RESEARCH tools for analysing *external reference videos*
// (competitor / trending clips). Do NOT run them on kino's own renders (we already have exact word
// timings from the TTS `…/with-timestamps` step — use `kino inspect`/`frames`), and never wire them
// into `build` or any production path.

function mockTranscript(): Transcript {
  const words = MOCK_TEXT.split(" ").map((w, i) => ({ word: w, start: round2(i * 0.3), end: round2((i + 1) * 0.3) }));
  return buildTranscript(words, { durationSec: round2(words.length * 0.3), fullText: MOCK_TEXT });
}

async function realTranscribe(video: string): Promise<Transcript> {
  const project = resolveProject();
  loadEnv(project.workspaceRoot);
  const apiKey = requireKey("ELEVENLABS_API_KEY");
  const dir = mkdtempSync(join(tmpdir(), "kino-stt-"));
  const wav = join(dir, "audio.wav");
  log.step("extract audio");
  await extractAudio(video, wav);
  const durationSec = await probeDuration(wav);
  if (!durationSec || durationSec < 0.05) throw new Error(`${video} has no audible audio track`);
  const cache = new Cache(project.cache);
  const key = contentHash({ kind: "scribe", model: "scribe_v1", size: statSync(wav).size });
  const cached = cache.get(key, "json");
  if (cached) return JSON.parse(readFileSync(cached, "utf8")) as Transcript;
  log.step("transcribe (Scribe)");
  const raw = await transcribeAudio(apiKey, wav);
  const words = scribeToWords(raw);
  if (!words.length) throw new Error(`${video} produced no speech (no audible words)`);
  const t = buildTranscript(words, { durationSec, language: raw.language_code, fullText: raw.text });
  const tmpJson = join(dir, "t.json");
  writeFileSync(tmpJson, JSON.stringify(t));
  cache.put(key, "json", tmpJson);
  return t;
}

function emit(t: Transcript, opts: { format?: string; out?: string }): void {
  const fmt = opts.format ?? "json";
  const body =
    fmt === "srt" ? wordsToSrt(t.segments)
    : fmt === "vtt" ? wordsToVtt(t.segments)
    : fmt === "text" ? wordsToText(t.segments)
    : JSON.stringify(t, null, 2);
  if (opts.out) {
    writeFileSync(opts.out, body);
    log.ok(opts.out);
  } else {
    console.log(body);
  }
}

export async function transcribe(
  video: string,
  opts: { format?: string; out?: string; mock?: boolean },
): Promise<Transcript> {
  const t = opts.mock ? mockTranscript() : await realTranscribe(video);
  emit(t, opts);
  return t;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/kino && npx vitest run tests/transcribe-mock.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/kino && git add src/commands/transcribe.ts tests/transcribe-mock.test.ts
git commit -m "feat: transcribe command (Scribe STT, mock, cache, srt/vtt/text)"
```

---

## Task 7: frames `--every`/`--count`

**Files:**
- Modify: `src/commands/frames.ts`

- [ ] **Step 1: Rewrite `frames.ts`** to use interval selection + the shared `extractFrame`:

```ts
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
  let times = parseTimes(opts.at ?? "");
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
```

- [ ] **Step 2: Verify the full suite still passes** (no behavior regressions; existing callers unaffected)

Run: `cd ~/kino && npx vitest run`
Expected: PASS (all tests, including Tasks 1–6).

- [ ] **Step 3: Commit**

```bash
cd ~/kino && git add src/commands/frames.ts
git commit -m "feat: frames --count/--every interval selection"
```

---

## Task 8: scan command (transcript + frames + montage)

**Files:**
- Create: `src/commands/scan.ts`
- Test: `tests/transcribe-mock.test.ts` (append)

- [ ] **Step 1: Write the failing test** — append to `tests/transcribe-mock.test.ts`:

```ts
import { scan } from "../src/commands/scan.js";
import { execa } from "execa";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("scan --mock", () => {
  it("writes a transcript, one frame per segment, and a montage", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-scan-"));
    const v = join(dir, "clip.mp4");
    await execa("ffmpeg", ["-y", "-loglevel", "error",
      "-f", "lavfi", "-i", "testsrc=duration=3:size=320x240:rate=30", "-pix_fmt", "yuv420p", v]);
    const r = await scan(v, { mock: true, out: join(dir, "scan") });
    expect(existsSync(r.transcriptPath)).toBe(true);
    expect(r.frames).toHaveLength(2); // mock transcript has two segments
    expect(r.frames.every((f) => existsSync(f))).toBe(true);
    expect(existsSync(r.montagePath)).toBe(true);
  }, 60000);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/kino && npx vitest run tests/transcribe-mock.test.ts`
Expected: FAIL — cannot find `../src/commands/scan.js`.

- [ ] **Step 3: Implement** — create `src/commands/scan.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/kino && npx vitest run tests/transcribe-mock.test.ts`
Expected: PASS (transcribe + scan).

- [ ] **Step 5: Commit**

```bash
cd ~/kino && git add src/commands/scan.ts tests/transcribe-mock.test.ts
git commit -m "feat: scan command (transcript + per-segment frames + montage)"
```

---

## Task 9: CLI wiring + version bump

**Files:**
- Modify: `src/cli.ts`, `package.json`

- [ ] **Step 1: Add `--every`/`--count` to the existing `frames` command** in `src/cli.ts` — locate the `.command("frames <video>")` block and add two options before its `.action(...)`:

```ts
  .option("--every <sec>", "a frame every N seconds (when --at is not given)")
  .option("--count <n>", "N frames spaced evenly (when --at is not given)")
```

- [ ] **Step 2: Register `transcribe` and `scan`** — add after the `frames` command block in `src/cli.ts`:

```ts
program
  .command("transcribe <video>")
  .description("Analyse an EXTERNAL reference video: transcribe speech to a timestamped transcript (research only — NOT for our own renders or the build pipeline)")
  .option("--format <fmt>", "json | srt | vtt | text", "json")
  .option("--out <file>", "write to a file instead of stdout")
  .option("--mock", "offline canned transcript (no ffmpeg/network)")
  .action(async (v, o) => {
    await (await import("./commands/transcribe.js")).transcribe(v, o);
  });

program
  .command("scan <video>")
  .description("Analyse an EXTERNAL reference video: transcript + frames + contact sheet in one shot (research only)")
  .option("--count <n>", "extract N frames evenly (default: one per transcript segment)")
  .option("--every <sec>", "extract a frame every N seconds")
  .option("--out <dir>", "output directory")
  .option("--mock", "offline canned transcript")
  .action(async (v, o) => {
    await (await import("./commands/scan.js")).scan(v, o);
  });
```

- [ ] **Step 3: Bump the version** — in `src/cli.ts` change `.version("1.11.1")` → `.version("1.12.0")`; in `package.json` change `"version": "1.11.1"` → `"version": "1.12.0"`.

- [ ] **Step 4: Typecheck, build, run the full suite**

Run: `cd ~/kino && npx tsc --noEmit && npm run build && npx vitest run`
Expected: tsc clean; build OK; all tests PASS.

- [ ] **Step 5: Smoke-test the CLI end to end (mock, offline)**

Run:
```bash
cd ~/kino && kino transcribe x.mp4 --mock --format srt
kino transcribe x.mp4 --mock | head -5
```
Expected: SRT cues for two segments; JSON with `words`/`segments`.

- [ ] **Step 6: Commit**

```bash
cd ~/kino && git add src/cli.ts package.json
git commit -m "feat: wire transcribe/scan CLI + frames flags; bump to v1.12.0"
```

---

## Task 10: Docs (agent guidance is a required deliverable)

**Files:**
- Modify: `skills/video-production/reference.md`, `skills/video-production/SKILL.md`, `README.md`

- [ ] **Step 1: Add a clearly-headed section to `skills/video-production/reference.md`** (place near the top, after the `## Commands` list which should also gain the three new entries):

```markdown
## Analysing reference videos (research only)

`transcribe` and `scan` exist to study **other people's** videos — competitor ads, trending /
reference clips (e.g. what `using-spider` downloads). They are a **research tool, not a production
step.**

- `kino transcribe <video> [--format json|srt|vtt|text] [--out <file>]` — speech → timestamped
  transcript (`{ text, words:[{word,start,end}], segments:[…] }`). JSON is the agent-readable
  default; cached by audio content-hash.
- `kino scan <video> [--count N | --every S]` — transcript + one frame per segment (or evenly) +
  a labeled contact sheet, in one call. "View this clip."
- `kino frames <video> --count N | --every S | --at 1,3,5 [--montage]` — pull stills.

**Do NOT** run these on kino's own renders (we already have exact word timings from TTS — use
`kino inspect`/`frames`/`still`), and never wire them into `build` or spec authoring. STT is
ElevenLabs Scribe (~$0.40/hr); needs `ELEVENLABS_API_KEY`.
```

Also add to the `## Commands` list at the top:

```markdown
- `kino transcribe <video> [--format …] [--out …]` — **(reference videos only)** speech → timestamped transcript
- `kino scan <video> [--count|--every]` — **(reference videos only)** transcript + frames + contact sheet
- `kino frames <video> [--at|--count|--every] [--montage]` — extract stills from any video
```

- [ ] **Step 2: Add the same guardrail to `skills/video-production/SKILL.md`** — add a short subsection (match the file's existing heading style) titled "Analysing reference videos (research only)" with this content:

```markdown
## Analysing reference videos (research only)

Use `kino transcribe <video>` / `kino scan <video>` ONLY to study external reference clips
(competitors, trending videos from `using-spider`). They transcribe speech to timestamped text and
pull frames so you can see what's said and shown.

Never use them on our own rendered output (we already have word timings from TTS — use `kino
inspect`), and never inside the build pipeline. See `reference.md` for flags.
```

- [ ] **Step 3: Update the `README.md` status line** — change it to:

```markdown
> **Status:** v1.12 — analyse external reference videos (`transcribe`/`scan`: Scribe STT + frame
> extraction, research-only); app cut-ins reveal the brand backdrop; word captions highlight the
> spoken word + brand name in green
```

- [ ] **Step 4: Verify docs + final full suite**

Run: `cd ~/kino && npx vitest run`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
cd ~/kino && git add skills/video-production/reference.md skills/video-production/SKILL.md README.md
git commit -m "docs: document transcribe/scan as research-only reference-video tools"
```

---

## Finish

After all tasks: use **superpowers:finishing-a-development-branch** to verify the full suite, then
merge `feat/video-inspection` to `main`, tag `v1.12.0`, push to `RimantsGroup/kino`, delete the
branch, and rebuild `dist` on `main` (matches the established flow for this repo).

---

## Self-Review

**Spec coverage:** transcribe (Tasks 2,3,4,6) · Scribe provider (Task 2) · frames `--every`/`--count`
(Tasks 5,7) · scan (Task 8) · `Transcript`/`TranscriptSegment` types (Task 3) · data flow
extract→Scribe→words→segments→formats (Tasks 1,2,4,6) · segment-grouping rules (Task 3) · error
handling: missing key / no-audio / Scribe non-2xx / mock (Task 6) · caching by audio hash (Task 6) ·
SRT/VTT/text (Task 4) · TDD unit + mock-integration tests (every task) · **intended-use guidance in
SKILL.md + reference.md + per-command --help** (Tasks 6,8,9,10) · out-of-scope items untouched. All
spec sections map to a task.

**Placeholder scan:** none — every code step has complete code; commands have exact flags/expected
output.

**Type consistency:** `WordTiming {word,start,end}` (existing) used everywhere; `Transcript` /
`TranscriptSegment` defined in Task 3 and consumed unchanged in Tasks 4/6/8; `scribeToWords` →
`WordTiming[]` feeds `buildTranscript`; `pickIntervalTimes(durationSec,{count,every})` signature
identical in Tasks 5/7/8; `extractAudio`/`extractFrame` signatures identical across Tasks 1/6/7/8;
command signatures (`transcribe(video,{format,out,mock})`, `scan(video,{count,every,out,mock})`)
consistent between implementation, tests, and CLI wiring.
