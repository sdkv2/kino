import React, { useLayoutEffect, useRef } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../../props";
import type { DrawFn } from "./presets";

// Generic frame-driven canvas. Draws via useLayoutEffect (synchronous, before paint) so Remotion
// captures the frame deterministically. Clears + paints the night base each frame, then runs `draw`.
export const CanvasBackground: React.FC<{ draw: DrawFn; colors: string[]; intensity: number; t: Theme }> = ({
  draw,
  colors,
  intensity,
  t,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const ref = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // reset any state a previous frame's draw may have left behind
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.filter = "none";
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = t.night;
    ctx.fillRect(0, 0, width, height);
    draw(ctx, { frame, fps, width, height, colors, intensity });
  });

  return (
    <AbsoluteFill style={{ backgroundColor: t.night }}>
      <canvas ref={ref} width={width} height={height} style={{ width: "100%", height: "100%" }} />
    </AbsoluteFill>
  );
};
