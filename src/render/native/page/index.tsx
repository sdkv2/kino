// Page boot for the native engine. window.kinoLoad() (re)initialises the page from
// /render-config.json — sizes the stage, swaps brand fonts, renders frame 0 — so a booted page is
// reused across render calls on the process-wide server without a navigation. window.kinoSeek(n)
// is a synchronous React commit (flushSync → layout effects paint canvases/shadow DOM) followed by
// an await on every <img>'s network completion, so a screenshot taken after resolution is the
// complete frame.
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { FrameProvider, type VideoConfig } from "./runtime";
import { MediaProvider, type MediaMap } from "./media";
import { KinoVideo } from "./KinoVideo";
import { settleScene } from "./scene/api";
import type { KinoProps } from "../../props.js";

interface RenderConfig {
  props: KinoProps;
  width: number;
  height: number;
  durationInFrames: number;
  media: MediaMap;
  gpu?: boolean; // KINO_GPU render mode; forwarded to Scene3D for 2× supersampling
}

declare global {
  interface Window {
    kinoLoad: () => Promise<void>;
    kinoSeek: (frame: number) => Promise<void>;
    __kinoReady: boolean;
    __kinoError?: string;
  }
}

async function settleImages(): Promise<void> {
  // Wait for network completion (load/error) only — NOT img.decode(): Chromium deprioritises
  // decode() on background tabs indefinitely, and every worker page but the frontmost is a
  // background tab. The screenshot raster decodes loaded bytes synchronously, so load is enough.
  const imgs = Array.from(document.querySelectorAll("img"));
  await Promise.all(
    imgs.map((img) => {
      if (img.complete) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const done = () => {
          img.removeEventListener("load", done);
          img.removeEventListener("error", done);
          resolve();
        };
        // A missing/failed image must not hang the render; the frame ships without it (parity with
        // a broken <Img> src, which surfaces as a blank layer, not a crash).
        img.addEventListener("load", done);
        img.addEventListener("error", done);
      });
    }),
  );
}

// Brand fonts keyed by family; re-pointed (delete + re-add) when a later render call uses a
// different file under the same family — two FontFaces on one family would make matching ambiguous.
const loadedFonts = new Map<string, FontFace>();

async function syncFonts(props: KinoProps): Promise<void> {
  const desired = new Map<string, string>();
  if (props.theme.fontUrl) desired.set("KinoBrandFont", "/public/" + props.theme.fontUrl);
  if (props.theme.labelFontUrl) desired.set("KinoLabelFont", "/public/" + props.theme.labelFontUrl);
  for (const [family, ff] of loadedFonts) {
    if (!desired.has(family)) {
      document.fonts.delete(ff);
      loadedFonts.delete(family);
    }
  }
  for (const [family, url] of desired) {
    const existing = loadedFonts.get(family);
    if (existing && (existing as FontFace & { __url?: string }).__url === url) continue;
    if (existing) {
      document.fonts.delete(existing);
      loadedFonts.delete(family);
    }
    const ff = new FontFace(family, `url(${url})`);
    (ff as FontFace & { __url?: string }).__url = url;
    await ff.load();
    document.fonts.add(ff);
    loadedFonts.set(family, ff);
  }
  await document.fonts.ready;
}

let root: Root | null = null;
let current: RenderConfig | null = null;

const App: React.FC<{ cfg: RenderConfig; frame: number }> = ({ cfg, frame }) => {
  const config: VideoConfig = { fps: cfg.props.fps, width: cfg.width, height: cfg.height, durationInFrames: cfg.durationInFrames, gpu: cfg.gpu };
  return (
    <MediaProvider media={cfg.media}>
      <FrameProvider frame={frame} config={config}>
        <KinoVideo {...cfg.props} />
      </FrameProvider>
    </MediaProvider>
  );
};

async function kinoSeek(frame: number): Promise<void> {
  const cfg = current;
  if (!cfg || !root) throw new Error("kinoSeek before kinoLoad");
  flushSync(() => root!.render(<App cfg={cfg} frame={frame} />));
  await settleImages();
  // 3D asset loads resolve async; a canvas doesn't repaint on texture arrival like an <img>
  // does — one more synchronous commit re-renders every live scene with settled assets.
  if (await settleScene()) {
    flushSync(() => root!.render(<App cfg={cfg} frame={frame} />));
  }
}

async function kinoLoad(): Promise<void> {
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
  // Fonts must be resolvable before frame 0 — a fallback-font first frame is a determinism and
  // layout bug, not a cosmetic one.
  await syncFonts(cfg.props);
  root ??= createRoot(container);
  current = cfg;
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
