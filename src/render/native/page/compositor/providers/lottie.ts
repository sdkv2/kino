// Tier-3 Lottie motion layers — seeked per frame, no autoplay.
import lottie, { type AnimationItem } from "lottie-web";
import type { LottieData, MotionGraphicProps } from "../../../../props.js";
import { lottiePlaybackRate } from "../../../../lottie.js";
import { lottieMeta } from "../../lottie.js";
import type { TextureSource } from "../graph.js";
import { uploadCanvasOrImage } from "./upload.js";

export function createLottieSource(opts: {
  data: MotionGraphicProps;
  width: number;
  height: number;
  beatFrom: number;
  beatDur: number;
}): TextureSource {
  const container = document.createElement("div");
  container.style.cssText = `position:absolute;left:-99999px;top:0;width:${opts.width}px;height:${opts.height}px;visibility:hidden`;
  document.body.appendChild(container);

  let anim: AnimationItem | null = null;
  let tex: WebGLTexture | null = null;
  let canvas: HTMLCanvasElement | null = null;
  const meta = lottieMeta(opts.data.lottie as LottieData);
  const loop = opts.data.loop ?? false;
  const rate = lottiePlaybackRate(meta.durationInFrames, opts.beatDur, loop);

  const ensureAnim = () => {
    if (anim) return;
    anim = lottie.loadAnimation({
      container,
      renderer: "canvas",
      loop: false,
      autoplay: false,
      animationData: opts.data.lottie,
      rendererSettings: { preserveAspectRatio: "xMidYMid meet", clearCanvas: true },
    });
    canvas = container.querySelector("canvas");
  };

  return {
    async prepare(frame: number): Promise<void> {
      ensureAnim();
      if (!anim || !canvas) return;
      const local = frame - opts.beatFrom;
      const raw = local * rate;
      const idx = loop ? raw % meta.durationInFrames : Math.min(raw, Math.max(0, meta.durationInFrames - 0.001));
      anim.goToAndStop(idx, true);
    },
    texture(gl: WebGL2RenderingContext): WebGLTexture | null {
      if (!canvas) return null;
      tex = uploadCanvasOrImage(gl, tex, canvas);
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
