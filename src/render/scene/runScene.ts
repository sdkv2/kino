// Node-side scene runner: linted .scene.js body → recording api → JSON timeline + sha1 hash.
// Replaces the deleted browser three.js path. Same api.* surface; Blender (T13) consumes the timeline.
import { createHash } from "node:crypto";
import type { Theme, WordTiming, BgKeyframe, BgTrigger } from "../props.js";
import { buildMotionEnv } from "../motionEnv.js";
import { lintSceneJs } from "../scene.js";
import { KINO_VERSION } from "../../version.js";
import {
  createRecordApi,
  type TimelineObject,
  type MaterialSpec,
  type FrameTransform,
  type CameraSnapshot,
} from "./recordApi.js";

export type { TimelineObject, MaterialSpec };

export interface TimelineFrame {
  transforms: Record<string, FrameTransform>;
  camera: CameraSnapshot;
}

export interface Timeline {
  meta: {
    width: number;
    height: number;
    fps: number;
    frameCount: number;
    quality: "draft" | "final" | "max";
    kinoVersion: string;
    // Cache inputs that may not mutate recorded transforms (unused params, whitespace-only edits).
    // Design: timeline hash covers source + params + words + quality + dims/fps.
    source: string;
    params: Record<string, number | string>;
    words: WordTiming[];
  };
  objects: TimelineObject[];
  world: "studio" | "night" | "none";
  post: { bloom?: { strength: number; radius: number; threshold: number } } | null;
  fontPath: string | null;
  frames: TimelineFrame[];
}

export interface RunSceneOpts {
  source: string;
  params: Record<string, number | string>;
  words: WordTiming[];
  theme: Theme;
  width: number;
  height: number;
  fps: number;
  durationFrames: number;
  quality: "draft" | "final" | "max";
  keyframes?: BgKeyframe[];
  triggers?: BgTrigger[];
}

/** Lint → record api → per-frame snapshots. Pure of (opts); hash is the stills cache key. */
export function runScene(opts: RunSceneOpts): { timeline: Timeline; hash: string } {
  const {
    source, params, words, theme, width, height, fps, durationFrames, quality,
    keyframes = [], triggers = [],
  } = opts;

  const violations = lintSceneJs(source);
  if (violations.length) throw new Error(violations.join("; "));

  const palette: Record<string, string> = {
    mint: theme.mint,
    green: theme.green,
    night: theme.night,
    white: theme.white,
    gold: theme.gold,
  };
  const recorder = createRecordApi({ baseParams: params, palette });

  // Lexical shadowing: banned globals are parameters bound to undefined (belt on lint's suspenders).
  const body = new Function(
    "api", "process", "require", "globalThis", "window", "document",
    source,
  ) as (
    api: unknown, process: undefined, require: undefined,
    globalThis: undefined, window: undefined, document: undefined,
  ) => unknown;
  const update = body(recorder.api, undefined, undefined, undefined, undefined, undefined);
  if (typeof update !== "function") throw new Error("scene(api) must return update(env)");

  const frames: TimelineFrame[] = [];
  const data = { html: "", params, keyframes, triggers, words };
  for (let f = 0; f < durationFrames; f++) {
    const env = buildMotionEnv({
      frame: f, fps, width, height, durationFrames,
      data, t: theme,
    });
    (update as (env: unknown) => void)(env);
    frames.push(recorder.snapshot());
  }

  // Brand TTF staging lands later (T14); family names like "Arial" are not paths.
  const fontPath =
    typeof theme.font === "string" && /\.(ttf|otf)$/i.test(theme.font) ? theme.font : null;

  const timeline: Timeline = {
    meta: {
      width, height, fps,
      frameCount: durationFrames,
      quality,
      kinoVersion: KINO_VERSION,
      source,
      params,
      words,
    },
    objects: recorder.objects,
    world: recorder.world(),
    post: recorder.post(),
    fontPath,
    frames,
  };

  const hash = createHash("sha1").update(JSON.stringify(timeline)).digest("hex");
  return { timeline, hash };
}
