// Page boot for the native engine. window.kinoLoad() (re)initialises the page from
// /render-config.json — sizes the stage, swaps brand fonts, renders frame 0 — so a booted page is
// reused across render calls on the process-wide server without a navigation. window.kinoSeek(n)
// is a synchronous React commit followed by the compositor's two-phase seek.
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { MediaProvider, type MediaMap } from "./media";
import { loadBgTextures } from "./bgTextures";
import { clearUnderlays } from "./underlay";
import type { KinoProps } from "../../props.js";
import { Stage, type StageHandle } from "./compositor/Stage.js";
import { resetPlateDupeProbe } from "./motionRaster.js";
import { awaited, enableProfile, resetProfile, snapshot } from "./compositor/profile.js";
import {
  captureH264Bytes,
  capturePipelined,
  captureSync,
  flushCapturePipeline,
  initCapture,
} from "./capturePipeline.js";
import type { CaptureCodec } from "../captureCodec.js";
import type { CaptureSource } from "../captureSource.js";

interface RenderConfig {
  props: KinoProps;
  /** Composition size — what the frame is laid out in (captions, motion-graphic px, layer rects). */
  width: number;
  height: number;
  /** Output canvas size. Absent → same as the composition. A draft sets it smaller: the frame is
   *  still composed at width×height, then rasterised onto this surface. */
  outWidth?: number;
  outHeight?: number;
  durationInFrames: number;
  media: MediaMap;
  shaderSS?: number;
  /** engine.ts has always serialised this; the page just never declared it, so the value was
   *  dropped and FXAA hardcoded on. KINO_SHADER_FXAA=0 did nothing until this was wired up. */
  shaderFXAA?: boolean;
  motionFoMin?: number;
  profile?: boolean;
  /** KINO_MOTION_DUPE_PROBE=1 — per-plate pixel-dupe counters, separate from `profile` because
   *  the hashing is heavy enough to distort its timing rows. */
  motionDupeProbe?: boolean;
  captureCodec?: CaptureCodec;
  captureSource?: CaptureSource;
}

declare global {
  interface Window {
    kinoLoad: () => Promise<void>;
    kinoSeek: (frame: number) => Promise<void>;
    kinoCapturePipelined: (slot: number) => Promise<void>;
    kinoCaptureSync: (slot: number) => Promise<void>;
    kinoFlushCapture: () => Promise<void>;
    /** Electron present-bypass: WebCodecs annex-B from the stage canvas. */
    kinoCaptureH264Bytes: () => Promise<Uint8Array>;
    kinoElectron?: {
      pushFrame?: (rgba: Uint8Array, width: number, height: number) => Promise<boolean>;
      pushH264?: (annexB: Uint8Array) => Promise<boolean>;
      frameReady?: (frame: number) => void;
    };
    __kinoCaptureCodec?: CaptureCodec;
    __kinoCaptureSource?: CaptureSource;
    __kinoReady: boolean;
    __kinoError?: string;
    __kinoShaderSS?: number;
    __kinoShaderFXAA?: boolean;
    __kinoProf?: () => Array<{ key: string; ms: number; n: number }>;
  }
}

const loadedFonts = new Map<string, FontFace>();

async function syncFonts(props: KinoProps): Promise<void> {
  const desired = new Map<string, string>();
  if (props.theme.fontUrl) desired.set("KinoBrandFont", "/public/" + props.theme.fontUrl);
  if (props.theme.labelFontUrl) desired.set("KinoLabelFont", "/public/" + props.theme.labelFontUrl);
  const fontSet = document.fonts as unknown as { delete: (f: FontFace) => void; add: (f: FontFace) => void };
  for (const [family, ff] of loadedFonts) {
    if (!desired.has(family)) {
      fontSet.delete(ff);
      loadedFonts.delete(family);
    }
  }
  for (const [family, url] of desired) {
    const existing = loadedFonts.get(family);
    if (existing && (existing as FontFace & { __url?: string }).__url === url) continue;
    if (existing) {
      fontSet.delete(existing);
      loadedFonts.delete(family);
    }
    const ff = new FontFace(family, `url(${url})`);
    (ff as FontFace & { __url?: string }).__url = url;
    await ff.load();
    fontSet.add(ff);
    loadedFonts.set(family, ff);
  }
  await document.fonts.ready;
}

let root: Root | null = null;
let current: RenderConfig | null = null;
let stageHandle: StageHandle | null = null;

async function kinoSeek(frame: number): Promise<void> {
  if (!current || !stageHandle) throw new Error("kinoSeek before kinoLoad");
  // `seek:stage` is the whole stage seek wall — the phase timers inside it (prep:*, draw) are
  // component costs; the difference is page work none of them cover (layersAt, await plumbing).
  const h = stageHandle;
  await awaited("seek:stage", () => h.seek(frame));
  // Electron shared capture: nudge OSR invalidate before executeJavaScript returns to main.
  window.kinoElectron?.frameReady?.(frame);
}

async function kinoLoad(): Promise<void> {
  window.__kinoFatal = undefined;
  const cfg: RenderConfig = await (await fetch("/render-config.json", { cache: "no-store" })).json();
  document.documentElement.style.background = "#000";
  document.body.style.margin = "0";
  const container = document.getElementById("root")!;
  const outW = cfg.outWidth ?? cfg.width;
  const outH = cfg.outHeight ?? cfg.height;
  // The container frames the CANVAS, not the composition: OSR paint capture grabs a window sized
  // to the output, so a container at composition size would crop it. The staging DOM the rasters
  // lay out in carries its own composition-sized box (Stage).
  Object.assign(container.style, {
    position: "relative",
    width: `${outW}px`,
    height: `${outH}px`,
    overflow: "hidden",
  });
  await syncFonts(cfg.props);
  // Underlay textures belong to the previous render's GL context — drop them with the bg textures.
  clearUnderlays();
  await loadBgTextures(cfg.props);
  window.__kinoShaderSS = cfg.shaderSS ?? 2;
  (globalThis as { __kinoMotionFoMin?: number }).__kinoMotionFoMin = cfg.motionFoMin;
  (globalThis as { __kinoMotionDupeProbe?: boolean }).__kinoMotionDupeProbe = cfg.motionDupeProbe === true;
  window.__kinoShaderFXAA = cfg.shaderFXAA !== false;
  enableProfile(cfg.profile === true);
  resetProfile();
  resetPlateDupeProbe();

  current = cfg;
  root ??= createRoot(container);
  await new Promise<void>((resolve) => {
    root!.render(
      <MediaProvider media={cfg.media}>
        <Stage
          props={cfg.props}
          dims={{ width: cfg.width, height: cfg.height }}
          out={{ width: outW, height: outH }}
          media={cfg.media}
          scale={cfg.shaderSS ?? 2}
          onReady={(h) => {
            stageHandle = h;
            resolve();
          }}
        />
      </MediaProvider>,
    );
  });
  await kinoSeek(0);
  const cap = await initCapture({
    codec: cfg.captureCodec ?? "h264",
    captureSource: cfg.captureSource ?? "bitmap",
    width: outW,
    height: outH,
    fps: cfg.props.fps,
  });
  window.__kinoCaptureCodec = cap.codec;
  window.__kinoCaptureSource = cap.source;
}

window.kinoLoad = kinoLoad;
window.kinoSeek = kinoSeek;
window.kinoCapturePipelined = capturePipelined;
window.kinoCaptureSync = captureSync;
window.kinoFlushCapture = flushCapturePipeline;
window.kinoCaptureH264Bytes = captureH264Bytes;
window.__kinoProf = snapshot;

kinoLoad()
  .then(() => {
    window.__kinoReady = true;
  })
  .catch((err) => {
    window.__kinoError = err instanceof Error ? (err.stack ?? err.message) : String(err);
  });
