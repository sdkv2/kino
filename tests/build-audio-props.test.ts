// The audio half of build.ts's spec→KinoProps mapping, through the REAL prepare() pipeline.
// Everything else about the audio slice is tested against hand-built props (tests/audio-mix) or as
// pure functions (tests/audio, tests/audio-filters) — this is the only thing that proves the
// authored fields survive the trip from spec.json into what the mixer is handed.
//
// It also pins the frame-cache contract: sfx is part of the frame-cache key
// (render/native/frameCache), so `pan`/`rate`/`voVolume` must be ABSENT from props at their
// defaults, or every project with a .frame-cache cold-starts on an upgrade that changes no pixels.
//
// Self-contained: a scratch `projects/<name>/` tree under mkdtempSync, resolved by prepare()'s own
// walk up from the spec path (projects/ is gitignored, so a named fixture project would not exist
// on CI). Music assets are real wavs — build.ts ffprobes each bed for the "shorter than the video"
// warning.
import { describe, it, expect } from "vitest";
import { execa } from "execa";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepare } from "../src/commands/build.js";
import { FFMPEG_PATH } from "../src/media/binPaths.js";

const TIMEOUT = 90000;

async function writeSpec(spec: Record<string, unknown>): Promise<string> {
  const ws = mkdtempSync(join(tmpdir(), "build-audio-"));
  const projectDir = join(ws, "projects", "demo");
  const specsDir = join(projectDir, "specs");
  const assetsDir = join(projectDir, "assets");
  mkdirSync(specsDir, { recursive: true });
  mkdirSync(join(assetsDir, "music"), { recursive: true });
  mkdirSync(join(assetsDir, "sfx"), { recursive: true });
  writeFileSync(join(projectDir, "project.json"), "{}");
  for (const rel of ["music/a.wav", "music/b.wav", "sfx/click.wav"]) {
    await execa(FFMPEG_PATH, [
      "-y", "-loglevel", "error",
      "-f", "lavfi", "-i", "aevalsrc=0.3*sin(2*PI*220*t)|0.3*sin(2*PI*220*t):d=12:s=44100",
      "-c:a", "pcm_s16le", join(assetsDir, rel),
    ]);
  }
  const path = join(specsDir, "spec.json");
  writeFileSync(path, JSON.stringify({ title: "audio-props", format: ["9:16"], colors: "midnight", ...spec }));
  return path;
}

const SEGMENTS = [
  { kind: "scene", text: "first beat speaking", caption: "first" },
  { kind: "scene", text: "second beat speaking", caption: "second" },
];

describe("build.ts → KinoProps audio mapping", () => {
  it("omits pan/rate/voVolume at their defaults, so the frame-cache key is unchanged", async () => {
    const specPath = await writeSpec({ segments: SEGMENTS, sfx: [{ src: "sfx/click.wav", at: 0.5, volume: 0.4 }] });
    const { props } = await prepare(specPath, { mock: true, format: "9:16" });
    // Deep-equal, not toMatchObject: the point is that no NEW keys appear.
    expect(props.sfx).toEqual([{ src: "sfx-0.wav", at: 0.5, volume: 0.4 }]);
    expect("voVolume" in props).toBe(false);
  }, TIMEOUT);

  it("carries pan, rate and voVolume through when the spec sets them", async () => {
    const specPath = await writeSpec({
      segments: SEGMENTS,
      voVolume: 0.8,
      sfx: [
        { src: "sfx/click.wav", at: 0.5, volume: 1, pan: -0.75 },
        { src: "sfx/click.wav", at: 1.5, volume: 1, rate: 1.25 },
      ],
    });
    const { props } = await prepare(specPath, { mock: true, format: "9:16" });
    expect(props.sfx![0]).toEqual({ src: "sfx-0.wav", at: 0.5, volume: 1, pan: -0.75 });
    expect(props.sfx![1]).toEqual({ src: "sfx-1.wav", at: 1.5, volume: 1, rate: 1.25 });
    expect(props.voVolume).toBe(0.8);
  }, TIMEOUT);

  it("normalizes a single bed to a one-element array and keeps its keyframes", async () => {
    const keyframes = [{ at: 2, params: { volume: 0.2 } }, { at: 4, params: { volume: 0 }, ease: "easeOut" }];
    const specPath = await writeSpec({ segments: SEGMENTS, music: { src: "music/a.wav", volume: 0.2, keyframes } });
    const { props } = await prepare(specPath, { mock: true, format: "9:16" });
    expect(props.music).toHaveLength(1);
    expect(props.music![0].src).toBe("music-0.wav");
    expect(props.music![0].keyframes).toEqual(keyframes);
  }, TIMEOUT);

  it("stages every bed of an array under its own name, sharing one set of duck spans", async () => {
    const specPath = await writeSpec({
      segments: SEGMENTS,
      music: [
        { src: "music/a.wav", volume: 0.1, startSec: 3 },
        { src: "music/b.wav", volume: 0.05, duck: 0.05, keyframes: [{ at: 1, params: { volume: 0.3 } }] },
      ],
    });
    const { props } = await prepare(specPath, { mock: true, format: "9:16" });
    expect(props.music!.map((m) => m.src)).toEqual(["music-0.wav", "music-1.wav"]);
    // Each bed keeps its own level/offset/curve…
    expect(props.music![0]).toMatchObject({ volume: 0.1, startSec: 3 });
    expect(props.music![0].keyframes).toBeUndefined();
    expect(props.music![1]).toMatchObject({ volume: 0.05, duck: 0.05, startSec: 0 });
    expect(props.music![1].keyframes).toEqual([{ at: 1, params: { volume: 0.3 } }]);
    // …but every bed ducks under the SAME VO spans, one per spoken beat.
    expect(props.music![0].duckSpans).toEqual(props.music![1].duckSpans);
    expect(props.music![0].duckSpans).toHaveLength(SEGMENTS.length);
  }, TIMEOUT);

  it("leaves music null when the spec has none", async () => {
    const specPath = await writeSpec({ segments: SEGMENTS });
    const { props } = await prepare(specPath, { mock: true, format: "9:16" });
    expect(props.music).toBeNull();
  }, TIMEOUT);
});

// Beat-relative sound effects. The reason they exist: a timeline-absolute `sfx[].at` is placed
// against mock estimates and is simply wrong once real TTS moves the beat boundaries — and unlike
// motion triggers there is no `kino retune` path back for sfx. A beat-relative `at` rides the beat;
// `atWord` rides the spoken word itself.
describe("segment-level sfx", () => {
  it("resolves a beat-relative `at` against the beat's start", async () => {
    const specPath = await writeSpec({
      segments: [
        { kind: "scene", text: "first beat speaking", caption: "first" },
        { kind: "scene", text: "second beat speaking", caption: "second", sfx: [{ src: "sfx/click.wav", at: 0.25, volume: 0.6 }] },
      ],
    });
    const { props } = await prepare(specPath, { mock: true, format: "9:16" });
    const beat1Start = props.segments[1].startSec;
    expect(props.sfx).toEqual([{ src: "sfx-s1-0.wav", at: Math.round((beat1Start + 0.25) * 1000) / 1000, volume: 0.6 }]);
    // It is genuinely offset by the beat, not coincidentally near zero.
    expect(beat1Start).toBeGreaterThan(0.5);
  }, TIMEOUT);

  it("anchors to a spoken word, and applies `offset` to the word start", async () => {
    const base = { kind: "scene", text: "it should be doing something", caption: "x" };
    const plain = await writeSpec({ segments: [{ ...base, sfx: [{ src: "sfx/click.wav", atWord: "doing" }] }] });
    const nudged = await writeSpec({ segments: [{ ...base, sfx: [{ src: "sfx/click.wav", atWord: "doing", offset: -0.04 }] }] });
    const a = (await prepare(plain, { mock: true, format: "9:16" })).props;
    const b = (await prepare(nudged, { mock: true, format: "9:16" })).props;
    // "doing" is the 4th of 5 words, so the anchor is well into the beat rather than at its head.
    expect(a.sfx![0].at).toBeGreaterThan(a.segments[0].startSec);
    // The offset moves it earlier by exactly 40ms — millisecond precision survives, which is the
    // point of offset (a frame is 33ms at 30fps).
    expect(Math.round((a.sfx![0].at - b.sfx![0].at) * 1000)).toBe(40);
  }, TIMEOUT);

  it("keeps sfx off the segment props, so the per-segment frame-cache signature can't see them", async () => {
    // frameCache hashes the WHOLE segment object. Resolving beat sfx into the flat props list at
    // build time is what keeps an audio edit from re-rendering the beat.
    const specPath = await writeSpec({
      segments: [{ kind: "scene", text: "first beat speaking", caption: "first", sfx: [{ src: "sfx/click.wav", at: 0.1 }] }],
    });
    const { props } = await prepare(specPath, { mock: true, format: "9:16" });
    expect(props.sfx).toHaveLength(1);
    expect("sfx" in props.segments[0]).toBe(false);
  }, TIMEOUT);

  it("merges timeline and beat effects into one list, staged under non-colliding names", async () => {
    const specPath = await writeSpec({
      segments: [
        { kind: "scene", text: "first beat speaking", caption: "first", sfx: [{ src: "sfx/click.wav", at: 0.1 }] },
        { kind: "scene", text: "second beat speaking", caption: "second", sfx: [{ src: "sfx/click.wav", at: 0.2 }] },
      ],
      sfx: [{ src: "sfx/click.wav", at: 0.5 }],
    });
    const { props } = await prepare(specPath, { mock: true, format: "9:16" });
    // Top-level ids stay bare so existing specs stage byte-identically.
    expect(props.sfx!.map((s) => s.src)).toEqual(["sfx-0.wav", "sfx-s0-0.wav", "sfx-s1-0.wav"]);
  }, TIMEOUT);

  it("fails loudly when atWord names a word the beat never speaks, listing what it does say", async () => {
    const specPath = await writeSpec({
      segments: [{ kind: "scene", text: "it should be doing something", caption: "x", sfx: [{ src: "sfx/click.wav", atWord: "shear" }] }],
    });
    await expect(prepare(specPath, { mock: true, format: "9:16" })).rejects.toThrow(/segment\[0\]\.sfx.*"shear".*doing/s);
  }, TIMEOUT);

  it("fails when atWord is used on a beat that speaks nothing", async () => {
    // A silent beat has no word timings, so the anchor could never fire. Failing beats silence.
    const specPath = await writeSpec({
      // `dur` with no `text` is the silent-beat form — no asset needed, and no word timings.
      segments: [{ kind: "scene", dur: 2, sfx: [{ src: "sfx/click.wav", atWord: "anything" }] }],
    });
    await expect(prepare(specPath, { mock: true, format: "9:16" })).rejects.toThrow(/no spoken words/);
  }, TIMEOUT);
});
