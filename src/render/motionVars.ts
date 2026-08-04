import type { Theme, BgParamValue, WordTiming, MotionEnv, MotionGraphicProps } from "./props.js";
import { progressCurves, paramsAt, pulseAt } from "./bgparams.js";
import { derivePalette, type UiRole } from "../config/palettes.js";
import { simEnvAt } from "./sim.js";
import { procLib } from "./procLib.js";
import { velocityRestVars } from "./motionVelocity.js";

/**
 * Custom-property names the motion runtime owns. A spec-level `data` key matching one of these
 * would overwrite the frame clock or a palette role in every graphic at once, so `validateSpecData`
 * rejects them at build time rather than letting a plausible-looking name (`progress`, `t`) take
 * the whole engine down silently.
 *
 * Everything under `--kino-` is reserved wholesale — the palette, the curves, the caption band, the
 * word counters and the velocity rest values all live there, and the set grows.
 */
export const RESERVED_MOTION_VARS = new Set([
  "frame", "t", "progress", "progress-num", "progress-den", "pulse", "cam-vel", "cam-blur",
]);

export interface MotionVarDynamics {
  frame: number;
  t: number;
  progress: number;
  pulse: number;
  params: Record<string, BgParamValue>;
  /** Spec-level shared constants (`spec.data`), emitted as `--<key>` BENEATH the beat's own
   *  params — see the note at the emission site. */
  data?: Record<string, BgParamValue>;
  fps?: number;
  /** Per-frame audio envelope (0..1, final mix RMS) at the COMPOSITION frame. */ 
  audio?: number;
  /** Resolved params at t − 1/fps — used for camera velocity. Omit on frame 0. */
  prevParams?: Record<string, BgParamValue>;
  /** Resolved params at t + 1/fps — opening-frame velocity lookahead. Omit on last frame. */
  nextParams?: Record<string, BgParamValue>;
  /** True when the spec defines a `cam` param (base or keyframes). */
  hasCam?: boolean;
  captionBottom?: number; // px from frame bottom where the caption band sits (0 = no caption this beat)
  wordsShown?: number; // spoken words whose start has been reached at this frame (0 when no VO words)
  wordCount?: number; // total spoken words in this beat (0 when no VO words)
  width?: number; // composition px (for aspect-aware layout)
  height?: number;
  /** Beat length in frames — pairs with `frame` for exact rational `--progress-num/den`. */
  durationFrames?: number;
}

/** Rebase absolute-timeline VO word spans to beat-relative (env.t / --progress are beat-relative,
 *  so a motion graphic compares its own clock to these directly). Returns undefined for no words
 *  so the optional prop simply stays absent. */
export function beatRelativeWords(words: WordTiming[] | undefined, startSec: number): WordTiming[] | undefined {
  if (!words || words.length === 0) return undefined;
  return words.map((w) => ({ word: w.word, start: w.start - startSec, end: w.end - startSec }));
}

/** Continuous count of the beat's spoken words shown by beat-relative time `t` (seconds): each
 *  word contributes its elapsed fraction (0→1 across its spoken span), so word-gated reveals like
 *  clamp(0, calc(var(--kino-words-shown) - i), 1) ease through the word instead of stepping at its
 *  start (the "weird lag" on gated lines). Reaches exactly k when word k finishes; zero-length
 *  spans count as fully shown at their start. Words are beat-relative. */
export function wordsShownAt(words: WordTiming[] | undefined, t: number): number {
  if (!words) return 0;
  let n = 0;
  for (const w of words) {
    if (t < w.start) continue;
    const span = w.end - w.start;
    n += span <= 0 ? 1 : Math.min(1, (t - w.start) / span);
  }
  return n;
}

/**
 * The six UI roles, resolved from whatever the theme carries.
 *
 * A Theme's UI roles are optional because most of them are derived, and build.ts fills them in — but
 * a KinoProps built by hand (test fixtures, `kino still` on a partial theme) may carry only the five
 * core ones. Re-deriving here rather than emitting `undefined` is the difference between a fabricated
 * panel painting with a default border and the entire element disappearing, which is what an
 * unresolved `var()` does to the declaration it sits in.
 */
export function uiPalette(t: Theme): Record<UiRole, string> {
  const p = derivePalette(
    { bg: t.bg, fg: t.fg, accent: t.accent, accent2: t.accent2, deep: t.deep },
    { surface: t.surface, line: t.line, muted: t.muted, ok: t.ok, warn: t.warn, danger: t.danger },
  );
  return { surface: p.surface, line: p.line, muted: p.muted, ok: p.ok, warn: p.warn, danger: p.danger };
}

/** The same six as `--kino-*` custom properties. */
export function uiRoleVars(t: Theme): Record<string, string> {
  const p = uiPalette(t);
  return {
    "--kino-surface": p.surface,
    "--kino-line": p.line,
    "--kino-muted": p.muted,
    "--kino-ok": p.ok,
    "--kino-warn": p.warn,
    "--kino-danger": p.danger,
  };
}

/** A key that is legal both as a CSS custom property and as a plain `env.data` lookup. */
const DATA_KEY = /^[A-Za-z][A-Za-z0-9_-]*$/;

/**
 * Validate `spec.data` — the shared-constants block.
 *
 * The block exists because a figure quoted on eight fabricated surfaces has to AGREE on all eight,
 * and per-beat params put eight copies of it in eight files. So the failure this guards against is
 * specific: a key that looks fine and silently overwrites something the engine owns would take a
 * whole render's timing or palette with it, and the symptom would appear in a graphic that never
 * mentioned the key.
 */
export function validateSpecData(data: unknown): string[] {
  if (data === undefined || data === null) return [];
  if (typeof data !== "object" || Array.isArray(data)) return ["data must be an object"];
  const errs: string[] = [];
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (!DATA_KEY.test(k)) {
      errs.push(`data.${k} is not a usable name — start with a letter and use letters, digits, - or _ (it becomes the CSS variable --${k})`);
    } else if (k.startsWith("kino-")) {
      errs.push(`data.${k} is reserved — every --kino-* variable belongs to the engine (palette, curves, caption band, word counters)`);
    } else if (RESERVED_MOTION_VARS.has(k)) {
      errs.push(`data.${k} is reserved — --${k} is set by the motion runtime every frame, so a constant here would be overwritten or would break the clock`);
    }
    if (typeof v !== "string" && (typeof v !== "number" || !Number.isFinite(v))) {
      errs.push(`data.${k} must be a string or a finite number`);
    }
  }
  return errs;
}

/** Normalize a spoken word for atWord matching: lowercase, letters+digits only. */
const wordKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Resolve word-anchored timing entries ({ atWord: "match" } or { atWord: 2 }) to concrete
 * beat-relative `at` seconds from the beat's VO word spans — so triggers/keyframes ride the real
 * TTS timing instead of hand-copied numbers that drift between mock and real VO. Text matches the
 * first occurrence, case/punctuation-insensitive; numbers are word indices. Plain `at` entries pass
 * through untouched. Throws (naming the beat's words) on a miss so typos fail at validate, not on
 * screen.
 */
export function resolveWordAnchors<T extends { at?: number; atWord?: string | number }>(
  track: T[] | undefined,
  words: WordTiming[] | undefined,
  where: string,
): (Omit<T, "at" | "atWord"> & { at: number })[] | undefined {
  if (!track) return undefined;
  return track.map((entry) => {
    const { atWord, at, ...rest } = entry;
    if (atWord == null) {
      if (at == null) throw new Error(`${where}: set exactly one of at / atWord`);
      return { ...rest, at } as Omit<T, "at" | "atWord"> & { at: number };
    }
    if (!words || words.length === 0) throw new Error(`${where}: atWord needs spoken words, but this beat has no spoken words`);
    let hit: WordTiming | undefined;
    if (typeof atWord === "number") {
      hit = words[atWord];
      if (!hit) throw new Error(`${where}: atWord ${atWord} out of range (beat has ${words.length} words)`);
    } else {
      hit = words.find((w) => wordKey(w.word) === wordKey(atWord));
      if (!hit) {
        throw new Error(`${where}: atWord "${atWord}" is not spoken in this beat — words: ${words.map((w) => w.word).join(" ")}`);
      }
    }
    return { ...rest, at: Math.round(hit.start * 1000) / 1000 } as Omit<T, "at" | "atWord"> & { at: number };
  });
}

const CAM_BLUR_DEFAULT = 12;
const CAM_BLUR_MAX = 18;
/** Soft opening haze at cam=0 (fraction of camBlur strength). */
const CAM_BLUR_REST_MIX = 0.22;

/** Velocity-blur vars for `.kino-camera` — pure, unit-tested. */
export function cameraBlurVars(
  params: Record<string, BgParamValue>,
  prevParams: Record<string, BgParamValue> | undefined,
  nextParams: Record<string, BgParamValue> | undefined,
  fps: number,
  hasCam: boolean,
): { camVel: number; camBlur: number } {
  if (!hasCam || typeof params.cam !== "number") return { camVel: 0, camBlur: 0 };
  const cam = params.cam;
  const prevCam = typeof prevParams?.cam === "number" ? prevParams.cam : cam;
  const nextCam = typeof nextParams?.cam === "number" ? nextParams.cam : cam;
  const velBack = prevParams === undefined || fps <= 0 ? 0 : Math.abs(cam - prevCam) * fps;
  const velFwd = nextParams === undefined || fps <= 0 ? 0 : Math.abs(nextCam - cam) * fps;
  const camVel = Math.max(velBack, velFwd);
  const strength = typeof params.camBlur === "number" ? params.camBlur : CAM_BLUR_DEFAULT;
  const open = 1 - cam;
  const restBlur = strength * CAM_BLUR_REST_MIX * open;
  const motionBlur = strength * camVel * open;
  const camBlur = Math.min(CAM_BLUR_MAX, restBlur + motionBlur);
  return { camVel, camBlur };
}

// Build the CSS custom properties set on a motion-graphic host every frame. The agent's shadow-scoped
// CSS reads these (they inherit across the shadow boundary): the frame-driven vars, every resolved
// spec param as --<key>, and the brand palette. Pure so it's unit-testable.
//   NOTE: --kino-gold MUST be here — omitting gold silently renders any gold-referencing declaration
//   invalid (invisible, no error).
export function buildMotionVars(t: Theme, dyn: MotionVarDynamics): Record<string, string> {
  const curves = progressCurves(dyn.progress);
  const vars: Record<string, string> = {
    "--frame": String(dyn.frame),
    "--t": dyn.t.toFixed(4),
    "--progress": dyn.progress.toFixed(6),
    "--progress-num": String(dyn.frame),
    "--progress-den": String(Math.max(1, dyn.durationFrames ?? 1)),
    // Eased progress (same curves as keyframe ease). Prefer these over linear --progress for
    // entrances/camera. overshoot/spring may briefly exceed 1 — fine for scale; clamp for opacity.
    "--kino-in": curves.in.toFixed(4),
    "--kino-out": curves.out.toFixed(4),
    "--kino-inout": curves.inout.toFixed(4),
    "--kino-overshoot": curves.overshoot.toFixed(4),
    "--kino-spring": curves.spring.toFixed(4),
    // 0 at beat edges, 1 mid-beat — seam-safe wash/breath (sin(progress·π)).
    "--kino-edge": curves.edge.toFixed(4),
    "--pulse": dyn.pulse.toFixed(4),
    // Final-mix loudness at this composition frame (0..1). 0 when the build has no audio, so an
    // authored `calc(var(--kino-audio) * ...)` degrades to silence rather than an invalid var().
    "--kino-audio": (dyn.audio ?? 0).toFixed(4),
    // Palette roles, plus the legacy literal-name aliases every pre-rename motion page uses.
    "--kino-bg": t.bg,
    "--kino-fg": t.fg,
    "--kino-accent": t.accent,
    "--kino-accent2": t.accent2,
    "--kino-deep": t.deep,
    "--kino-night": t.bg,
    "--kino-white": t.fg,
    "--kino-mint": t.accent,
    "--kino-gold": t.accent2,
    "--kino-green": t.deep,
    // The UI roles. Derived from the five above at build time; re-derived here from whatever the
    // theme carries so a hand-built props object (every test fixture, `kino still` on a bare theme)
    // resolves them to something real rather than leaving `var(--kino-line)` undefined — which
    // would not fall back, it would take the whole declaration and the element's paint with it.
    ...uiRoleVars(t),
    "--kino-font": t.font,
    // Second typeface for label/mono-style text inside a motion beat, distinct from the caption
    // font — falls back to --kino-font so it's never invalid when the brand sets no labelFont.
    "--kino-label-font": t.labelFont ?? t.font,
    // The caption band bottom (px from frame bottom; 0 when this beat has no caption) so authors can
    // position their own text clear of kino's auto caption, e.g. bottom: calc(var(--kino-caption-bottom) + 24px).
    "--kino-caption-bottom": `${dyn.captionBottom ?? 0}px`,
    // Spoken-word progress, so a stylised graphic can type text in sync with the VO without
    // hand-placed keyframes: reveal the first --kino-words-shown of --kino-word-count words.
    // Continuous (fraction into the current word's span) — 3dp keeps integer values printing bare.
    "--kino-words-shown": String(Math.round((dyn.wordsShown ?? 0) * 1000) / 1000),
    "--kino-word-count": String(dyn.wordCount ?? 0),
    // Resting per-element velocity. Overridden inline on each `data-kino-vel` element by the
    // measurement pass; published here so an element that never opted in still resolves the variable
    // to 0 rather than leaving the whole declaration invalid (an undefined var() takes the element's
    // paint with it — the silent-invisibility failure this workstream keeps running into).
    ...velocityRestVars(),
  };
  if (dyn.width && dyn.height) vars["--kino-aspect"] = (dyn.width / dyn.height).toFixed(4);
  // Spec-level constants first, the beat's own params second, so a beat can override a shared
  // figure locally and a graphic that names neither still resolves. Both land in the same `--<key>`
  // namespace on purpose: a motion page reading `var(--p95)` should not have to know whether the
  // number is shared across the piece or set on this beat — that is the author's decision to move,
  // not the page's to track. The reserved names are kept out of reach by validateSpecData.
  for (const [k, v] of Object.entries(dyn.data ?? {})) vars[`--${k}`] = String(v);
  for (const [k, v] of Object.entries(dyn.params)) vars[`--${k}`] = String(v);
  const { camVel, camBlur } = cameraBlurVars(
    dyn.params,
    dyn.prevParams,
    dyn.nextParams,
    dyn.fps ?? 0,
    dyn.hasCam ?? false,
  );
  vars["--cam-vel"] = camVel.toFixed(4);
  vars["--cam-blur"] = camBlur.toFixed(4);
  return vars;
}

/**
 * Everything one frame of a motion beat resolves to, before its markup is produced: the CSS custom
 * properties for the host, and the `env` a Tier-2 `render(env)` receives.
 *
 * Extracted so the two places that need it cannot drift: the in-page compositor provider, which
 * renders the frame, and the Node-side `kino still --dump-html`, which reproduces the exact markup
 * a frame emitted. A dump computed from a second, hand-copied definition of `env` would be a dump
 * of something the renderer never saw — worse than no dump at all.
 *
 * Pure: every input is a function of `local`, so calling it twice (the velocity pass needs the
 * previous frame too) is free of order effects.
 */
export function motionFrameState(
  data: Pick<MotionGraphicProps, "params" | "keyframes" | "words"> &
    Partial<Pick<MotionGraphicProps, "triggers" | "sim">>,
  ctx: {
    local: number;
    fps: number;
    durationFrames: number;
    theme: Theme;
    width: number;
    height: number;
    captionBottom?: number;
    /** Per-frame audio envelope (0..1, final mix RMS), and the composition frame it starts at. */
    audio?: number[];
    audioFrom?: number;
    /** Spec-level shared constants. Reaches CSS as `--<key>` and Tier 2 as `env.data`. */
    specData?: Record<string, BgParamValue>;
  },
): { env: MotionEnv; vars: Record<string, string> } {
  const { local, fps, durationFrames, theme } = ctx;
  const tt = fps > 0 ? local / fps : 0;
  const resolved = paramsAt(data.params, data.keyframes, tt, { implicitBase: true });
  const prevResolved = local > 0 ? paramsAt(data.params, data.keyframes, tt - 1 / fps, { implicitBase: true }) : undefined;
  const nextResolved =
    local < durationFrames - 1 ? paramsAt(data.params, data.keyframes, tt + 1 / fps, { implicitBase: true }) : undefined;
  const hasCam = "cam" in data.params || data.keyframes.some((k) => "cam" in k.params);
  const pulse = pulseAt(data.triggers ?? [], tt);
  const progress = durationFrames > 0 ? Math.min(1, Math.max(0, local / durationFrames)) : 0;
  const curves = progressCurves(progress);
  const { camVel, camBlur } = cameraBlurVars(resolved, prevResolved, nextResolved, fps, hasCam);
  // The envelope is keyed by COMPOSITION frame (the mix spans the whole timeline); a beat sits at
  // audioFrom + local. Missing/absent → 0, which is also what a still/dump (no audio built) sees.
  const audioAt = (() => {
    const envArr = ctx.audio;
    if (!envArr?.length || ctx.audioFrom == null) return 0;
    const f = Math.min(envArr.length - 1, Math.max(0, ctx.audioFrom + local));
    return envArr[f] ?? 0;
  })();
  const vars = buildMotionVars(theme, {
    frame: local,
    t: tt,
    progress,
    pulse,
    audio: audioAt,
    params: resolved,
    fps,
    prevParams: prevResolved,
    nextParams: nextResolved,
    hasCam,
    data: ctx.specData,
    captionBottom: ctx.captionBottom,
    wordsShown: 0,
    wordCount: data.words?.length ?? 0,
    width: ctx.width,
    height: ctx.height,
    durationFrames,
  });
  const env: MotionEnv = {
    frame: local,
    t: tt,
    progress,
    in: curves.in,
    out: curves.out,
    inout: curves.inout,
    overshoot: curves.overshoot,
    spring: curves.spring,
    edge: curves.edge,
    pulse,
    audio: audioAt,
    params: resolved,
    data: ctx.specData ?? {},
    camVel,
    camBlur,
    palette: {
      bg: theme.bg,
      fg: theme.fg,
      accent: theme.accent,
      accent2: theme.accent2,
      deep: theme.deep,
      // Same derivation the CSS vars take, so a Tier-2 proc reading env.palette.line and a Tier-1
      // page reading var(--kino-line) get the same colour.
      ...uiPalette(theme),
      // Legacy literal-name aliases (pre-rename Tier-2 pages read these).
      mint: theme.accent,
      green: theme.deep,
      night: theme.bg,
      white: theme.fg,
      gold: theme.accent2,
      font: theme.font,
    },
    width: ctx.width,
    height: ctx.height,
    words: data.words ?? [],
    durationFrames,
    duration: fps > 0 ? durationFrames / fps : 0,
    lib: procLib,
    // Indexed on the BEAT-LOCAL frame, the same clock env.frame runs on — so a held beat holds its
    // sim and a carried one carries it, with no arithmetic in the graphic.
    sim: simEnvAt(data.sim, local),
  };
  return { env, vars };
}
