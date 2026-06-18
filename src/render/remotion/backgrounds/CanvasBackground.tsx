import React, { useLayoutEffect, useRef } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme, BgParamValue, BgKeyframe, BgTrigger } from "../../props";
import { paramsAt, pulseAt } from "../../bgparams";
import type { DrawFn } from "./presets";

// Generic frame-driven canvas. Each frame: clear + paint night, resolve the agent's tweened params
// + trigger pulse at the current time, then run `draw`. useLayoutEffect (sync, pre-paint) so Remotion
// captures it deterministically.
export const CanvasBackground: React.FC<{
  draw: DrawFn;
  params: Record<string, BgParamValue>;
  keyframes: BgKeyframe[];
  triggers: BgTrigger[];
  t: Theme;
}> = ({ draw, params, keyframes, triggers, t }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const ref = useRef<HTMLCanvasElement>(null);

  // Intentional: this re-runs on the frame-derived inputs to redraw every frame. The dep array is
  // deliberate (Remotion advances frame-by-frame); it is NOT a missing-deps bug — do not add a [].
  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.filter = "none";
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = t.night;
    ctx.fillRect(0, 0, width, height);
    const tt = frame / fps;
    draw(ctx, { frame, fps, width, height, params: paramsAt(params, keyframes, tt), pulse: pulseAt(triggers, tt) });
  });

  return (
    <AbsoluteFill style={{ backgroundColor: t.night }}>
      <canvas ref={ref} width={width} height={height} style={{ width: "100%", height: "100%" }} />
    </AbsoluteFill>
  );
};
