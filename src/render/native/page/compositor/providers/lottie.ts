// Tier-3 Lottie motion layers — seeked per frame, no autoplay.
import lottie, { type AnimationItem } from "lottie-web";
import type { LottieData, MotionGraphicProps } from "../../../../props.js";
import { lottiePlaybackRate } from "../../../../lottie.js";
import { lottieMeta } from "../../lottie.js";
import type { TextureSource } from "../graph.js";
import { uploadCanvasOrImage } from "./upload.js";

type CanvasRenderer = { canvasContext?: { canvas: HTMLCanvasElement } };

export function createLottieSource(opts: {
  data: MotionGraphicProps;
  width: number;
  height: number;
  fps: number;
  beatFrom: number;
  beatDur: number;
}): TextureSource {
  const container = document.createElement("div");
  container.style.cssText = `position:absolute;left:-99999px;top:0;width:${opts.width}px;height:${opts.height}px;visibility:hidden`;
  document.body.appendChild(container);

  let anim: AnimationItem | null = null;
  let tex: WebGLTexture | null = null;
  const meta = lottieMeta(opts.data.lottie as LottieData);
  const loop = opts.data.loop ?? false;
  const rate = lottiePlaybackRate(meta.durationInFrames, opts.beatDur, loop);
  const burstFrames = Math.max(1, Math.round(meta.durationInSeconds * opts.fps));
  const burstRate = lottiePlaybackRate(meta.durationInFrames, burstFrames, false);

  const loadAnim = (): Promise<AnimationItem> =>
    new Promise((resolve) => {
      if (anim) {
        resolve(anim);
        return;
      }
      const a = lottie.loadAnimation({
        container,
        renderer: "canvas",
        loop: false,
        autoplay: false,
        animationData: opts.data.lottie,
        rendererSettings: { preserveAspectRatio: "xMidYMid meet", clearCanvas: true },
      });
      if (a.isLoaded) {
        anim = a;
        resolve(a);
      } else {
        a.addEventListener("DOMLoaded", () => {
          anim = a;
          resolve(a);
        });
      }
    });

  const canvas = (): HTMLCanvasElement | null =>
    (anim?.renderer as CanvasRenderer | undefined)?.canvasContext?.canvas ?? null;

  return {
    async prepare(frame: number): Promise<void> {
      const a = await loadAnim();
      const local = frame - opts.beatFrom;

      const triggers = opts.data.triggers?.filter((t) => t.action === "play") ?? [];
      if (triggers.length > 0) {
        let active = false;
        let burstLocal = 0;
        for (const tr of triggers) {
          const from = Math.round(tr.at * opts.fps);
          if (local >= from && local < from + burstFrames) {
            active = true;
            burstLocal = local - from;
            break;
          }
        }
        const c = canvas();
        if (!active) {
          if (c) c.getContext("2d")?.clearRect(0, 0, c.width, c.height);
          return;
        }
        const idx = Math.min(burstLocal * burstRate, Math.max(0, meta.durationInFrames - 0.001));
        a.goToAndStop(idx, true);
        return;
      }

      const raw = local * rate;
      const idx = loop ? raw % meta.durationInFrames : Math.min(raw, Math.max(0, meta.durationInFrames - 0.001));
      a.goToAndStop(idx, true);
    },
    texture(gl: WebGL2RenderingContext): WebGLTexture | null {
      const c = canvas();
      if (!c) return null;
      tex = uploadCanvasOrImage(gl, tex, c);
      return tex;
    },
    size(): { w: number; h: number } {
      return { w: opts.width, h: opts.height };
    },
    dispose(): void {
      anim?.destroy();
      anim = null;
      container.remove();
    },
  };
}
