// Canvas2D background presets. A port of CanvasBackground's per-frame body: reset transform
// and compositing state, clear, paint night, resolve tweened params and the trigger pulse at
// this frame's time, run the preset's draw.
import type { BgKeyframe, BgParamValue, BgTrigger, Theme } from "../../../../props.js";
import { paramsAt, pulseAt } from "../../../../bgparams.js";
import type { DrawFn } from "../../../../backgrounds/presets.js";
import { registerBackdrop } from "../../liquidGlass.js";
import type { TextureSource } from "../graph.js";
import { uploadCanvasOrImage } from "./upload.js";

export function createCanvas2dSource(opts: {
  draw: DrawFn;
  params: Record<string, BgParamValue>;
  keyframes: BgKeyframe[];
  triggers: BgTrigger[];
  theme: Pick<Theme, "night">;
  width: number;
  height: number;
  fps: number;
  clearNight?: boolean;
}): TextureSource & { canvasForTest(): HTMLCanvasElement } {
  const canvas = document.createElement("canvas");
  canvas.width = opts.width;
  canvas.height = opts.height;
  let tex: WebGLTexture | null = null;

  return {
    async prepare(frame: number): Promise<void> {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.filter = "none";
      ctx.clearRect(0, 0, opts.width, opts.height);
      if (opts.clearNight ?? true) {
        ctx.fillStyle = opts.theme.night;
        ctx.fillRect(0, 0, opts.width, opts.height);
      }
      const t = frame / opts.fps;
      opts.draw(ctx, {
        frame, fps: opts.fps, width: opts.width, height: opts.height,
        params: paramsAt(opts.params, opts.keyframes, t),
        pulse: pulseAt(opts.triggers, t),
      });
      registerBackdrop(canvas, opts.width, opts.height);
    },
    texture(gl: WebGL2RenderingContext): WebGLTexture | null {
      tex = uploadCanvasOrImage(gl, tex, canvas);
      return tex;
    },
    size(): { w: number; h: number } {
      return { w: opts.width, h: opts.height };
    },
    canvasForTest(): HTMLCanvasElement {
      return canvas;
    },
  };
}
