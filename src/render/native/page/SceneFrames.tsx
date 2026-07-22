// Blender-rendered 3D scene beat: a dumb per-frame <img> swap. Stills are pre-rendered node-side
// (ensureSceneStills) into /scene3d/<dir>/f00001.png…; this component owns no render logic, only
// frame→file. Images settle via the page's existing settleImages() await — no new machinery.
import React from "react";
import { AbsoluteFill, useCurrentFrame } from "./runtime";

export const SceneFrames: React.FC<{ frames: { dir: string; count: number } }> = ({ frames }) => {
  const frame = useCurrentFrame();
  const n = Math.min(frame, frames.count - 1) + 1;
  return (
    <AbsoluteFill>
      <img src={`/scene3d/${frames.dir}/f${String(n).padStart(5, "0")}.png`} style={{ width: "100%", height: "100%" }} />
    </AbsoluteFill>
  );
};
