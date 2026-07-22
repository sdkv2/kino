// 3D beat layer: one transparent WebGL canvas in the MotionGraphic slot. The scene body runs
// once per mount (constructs the graph, requests assets); update(env) + renderer.render run
// synchronously in a layout effect inside the flushSync seek, so the screenshot always captures
// the finished frame. TRUST BOUNDARY: data.scene is config-supplied code — safe only because it
// passed lintSceneJs (src/render/scene.ts). Never feed untrusted input here.
import React, { useLayoutEffect, useRef } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
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
  composer?: EffectComposer; // present only when the scene declared api.post({ bloom })
}

export const Scene3D: React.FC<{ data: MotionGraphicProps; durationFrames: number; t: Theme }> = ({ data, durationFrames, t }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const builtRef = useRef<Built | null>(null);
  const frame = useCurrentFrame();
  const { fps, width, height, gpu } = useVideoConfig();

  // Build once per mount (beats remount per Sequence; asset loads are URL-cached in api.ts).
  useLayoutEffect(() => {
    const canvas = canvasRef.current!;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    // Supersample on real GPU: render the drawing buffer at 2× and let the canvas' CSS size (100%,
    // i.e. composition size) downscale it on composite → cheap, high-quality SSAA. SwiftShader stays
    // 1× (software is already slow; the render mode is in the frame-cache signature so 1× vs 2× never
    // cross-serve). setSize(...,false) leaves CSS untouched, so only the buffer resolution changes.
    const ss = gpu ? 2 : 1;
    renderer.setSize(width * ss, height * ss, false);
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
    // Bloom (opt-in via api.post): EffectComposer chain instead of a direct render. The RenderPass
    // clears to transparent (clearAlpha 0) so bloom composites over the 2D layers beneath the canvas;
    // OutputPass applies the renderer's ACES tone-map + sRGB once at the end of the chain (in-chain
    // passes are linear). Composer buffer matches the supersampled size.
    const post = ctx.post();
    let composer: EffectComposer | undefined;
    if (post?.bloom) {
      composer = new EffectComposer(renderer);
      composer.setSize(width * ss, height * ss);
      const renderPass = new RenderPass(ctx.root, ctx.camera());
      renderPass.clearAlpha = 0;
      composer.addPass(renderPass);
      const b = post.bloom;
      composer.addPass(
        new UnrealBloomPass(new THREE.Vector2(width * ss, height * ss), b.strength ?? 0.6, b.radius ?? 0.4, b.threshold ?? 0.85),
      );
      composer.addPass(new OutputPass());
    }
    builtRef.current = { renderer, root: ctx.root, camera: ctx.camera, update, composer };
    return () => {
      composer?.dispose();
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
    if (b.composer) b.composer.render();
    else b.renderer.render(b.root, b.camera());
  });

  return (
    <AbsoluteFill>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
    </AbsoluteFill>
  );
};
