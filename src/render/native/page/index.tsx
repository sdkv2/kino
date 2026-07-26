// Page boot for the native engine. window.kinoLoad() (re)initialises the page from
// /render-config.json — sizes the stage, swaps brand fonts, renders frame 0 — so a booted page is
// reused across render calls on the process-wide server without a navigation. window.kinoSeek(n)
// is a synchronous React commit followed by the compositor's two-phase seek.
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { MediaProvider, type MediaMap } from "./media";
import { loadBgTextures } from "./bgTextures";
import type { KinoProps } from "../../props.js";
import { Stage, type StageHandle } from "./compositor/Stage.js";

interface RenderConfig {
  props: KinoProps;
  width: number;
  height: number;
  durationInFrames: number;
  media: MediaMap;
  shaderSS?: number;
}

declare global {
  interface Window {
    kinoLoad: () => Promise<void>;
    kinoSeek: (frame: number) => Promise<void>;
    __kinoReady: boolean;
    __kinoError?: string;
    __kinoShaderSS?: number;
    __kinoShaderFXAA?: boolean;
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
  await stageHandle.seek(frame);
}

async function kinoLoad(): Promise<void> {
  window.__kinoFatal = undefined;
  const cfg: RenderConfig = await (await fetch("/render-config.json", { cache: "no-store" })).json();
  document.documentElement.style.background = "#000";
  document.body.style.margin = "0";
  const container = document.getElementById("root")!;
  Object.assign(container.style, {
    position: "relative",
    width: `${cfg.width}px`,
    height: `${cfg.height}px`,
    overflow: "hidden",
  });
  await syncFonts(cfg.props);
  await loadBgTextures(cfg.props);
  window.__kinoShaderSS = cfg.shaderSS ?? 2;
  window.__kinoShaderFXAA = true;

  current = cfg;
  root ??= createRoot(container);
  await new Promise<void>((resolve) => {
    root!.render(
      <MediaProvider media={cfg.media}>
        <Stage
          props={cfg.props}
          dims={{ width: cfg.width, height: cfg.height }}
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
}

window.kinoLoad = kinoLoad;
window.kinoSeek = kinoSeek;

kinoLoad()
  .then(() => {
    window.__kinoReady = true;
  })
  .catch((err) => {
    window.__kinoError = err instanceof Error ? (err.stack ?? err.message) : String(err);
  });
