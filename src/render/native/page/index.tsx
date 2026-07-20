// Page boot for the native engine. Loads /render-config.json (props + dims + pre-extracted media
// map), loads brand fonts BEFORE the first frame, then exposes window.kinoSeek(frame): a
// synchronous React commit (flushSync → layout effects paint canvases/shadow DOM) followed by an
// await on every <img> decode, so a screenshot taken after resolution is the complete frame.
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { FrameProvider, type VideoConfig } from "./runtime";
import { MediaProvider, type MediaMap } from "./media";
import { KinoVideo } from "./KinoVideo";
import type { KinoProps } from "../../props.js";

interface RenderConfig {
  props: KinoProps;
  width: number;
  height: number;
  durationInFrames: number;
  media: MediaMap;
}

declare global {
  interface Window {
    kinoSeek: (frame: number) => Promise<void>;
    __kinoReady: boolean;
    __kinoError?: string;
  }
}

async function loadFont(family: string, url: string): Promise<void> {
  const ff = new FontFace(family, `url(${url})`);
  await ff.load();
  document.fonts.add(ff);
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
        // a broken <Img> src, which the legacy engine also surfaced as a blank layer, not a crash).
        img.addEventListener("load", done);
        img.addEventListener("error", done);
      });
    }),
  );
}

async function boot(): Promise<void> {
  const cfg: RenderConfig = await (await fetch("/render-config.json")).json();
  const { props, width, height, durationInFrames, media } = cfg;

  document.documentElement.style.background = "#000";
  document.body.style.margin = "0";
  const container = document.getElementById("root")!;
  Object.assign(container.style, {
    position: "relative",
    width: `${width}px`,
    height: `${height}px`,
    overflow: "hidden",
  });

  // Brand fonts must be resolvable before frame 0 — a fallback-font first frame is a determinism
  // and layout bug, not a cosmetic one.
  if (props.theme.fontUrl) await loadFont("KinoBrandFont", "/public/" + props.theme.fontUrl);
  if (props.theme.labelFontUrl) await loadFont("KinoLabelFont", "/public/" + props.theme.labelFontUrl);
  await document.fonts.ready;

  const config: VideoConfig = { fps: props.fps, width, height, durationInFrames };
  const root: Root = createRoot(container);

  const App: React.FC<{ frame: number }> = ({ frame }) => (
    <MediaProvider media={media}>
      <FrameProvider frame={frame} config={config}>
        <KinoVideo {...props} />
      </FrameProvider>
    </MediaProvider>
  );

  window.kinoSeek = async (frame: number) => {
    flushSync(() => root.render(<App frame={frame} />));
    await settleImages();
  };

  await window.kinoSeek(0);
  window.__kinoReady = true;
}

boot().catch((err) => {
  window.__kinoError = err instanceof Error ? (err.stack ?? err.message) : String(err);
});
