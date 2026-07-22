// 3D beat layer: one transparent WebGL canvas in the MotionGraphic slot. The scene body runs
// once per mount (constructs the graph, requests assets); update(env) + renderer.render run
// synchronously in a layout effect inside the flushSync seek, so the screenshot always captures
// the finished frame. TRUST BOUNDARY: data.scene is config-supplied code — safe only because it
// passed lintSceneJs (src/render/scene.ts). Never feed untrusted input here.
import React, { useLayoutEffect, useRef } from "react";
import * as THREE from "three";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "../runtime";
import type { MotionGraphicProps } from "../../../props.js";
import type { Theme } from "../../../props.js";
import { buildMotionEnv } from "../MotionGraphic";
import { createSceneApi } from "./api";

interface Built {
  renderer: THREE.WebGLRenderer;
  root: THREE.Scene;
  camera: () => THREE.PerspectiveCamera;
  update: (env: unknown) => void;
}

export const Scene3D: React.FC<{ data: MotionGraphicProps; durationFrames: number; t: Theme }> = ({ data, durationFrames, t }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const builtRef = useRef<Built | null>(null);
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  // Build once per mount (beats remount per Sequence; asset loads are URL-cached in api.ts).
  useLayoutEffect(() => {
    const canvas = canvasRef.current!;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const ctx = createSceneApi({
      baseParams: data.params,
      palette: { mint: t.mint, green: t.green, night: t.night, white: t.white, gold: t.gold, font: t.font },
      width, height,
    });
    // TRUST BOUNDARY (see file header): linted config code.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const update = new Function("api", data.scene!)(ctx.api) as (env: unknown) => void;
    if (typeof update !== "function") throw new Error("scene(api) must return update(env)");
    ctx.applyEnv(renderer);
    builtRef.current = { renderer, root: ctx.root, camera: ctx.camera, update };
    return () => {
      renderer.dispose();
      builtRef.current = null;
    };
  }, [data.scene]);

  // Intentional no-deps: re-runs every frame commit (engine advances frame-by-frame) AND on the
  // post-settle second flushSync pass — same pattern as ShadowHtml. Not a missing-deps bug.
  useLayoutEffect(() => {
    const b = builtRef.current;
    if (!b) return;
    b.update(buildMotionEnv({ frame, fps, width, height, durationFrames, data, t }));
    b.renderer.render(b.root, b.camera());
  });

  return (
    <AbsoluteFill>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
    </AbsoluteFill>
  );
};
