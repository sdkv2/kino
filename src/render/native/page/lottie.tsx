// Tier-3 Lottie playback for the native engine: lottie-web (SVG renderer) mounted per graphic,
// seeked with goToAndStop(frameIndex, true) every frame — a pure function of the composition frame,
// no autoplay, no wall clock. Frame mapping matches the pinned behavior in src/render/lottie.ts:
// lottieFrame = beatLocalFrame × playbackRate (frame-index-direct; see lottiePlaybackRate).
import React, { useLayoutEffect, useRef } from "react";
import lottie, { type AnimationItem } from "lottie-web";
import { useCurrentFrame } from "./runtime";
import type { LottieData } from "../../props.js";

export interface LottieMeta {
  durationInFrames: number; // native frames (op - ip)
  durationInSeconds: number;
}

// Bodymovin duration fields are validated at resolve time (parseLottie), so this is total here.
export function lottieMeta(data: LottieData): LottieMeta {
  const ip = Number(data.ip);
  const op = Number(data.op);
  const fr = Number(data.fr);
  const durationInFrames = op - ip;
  return { durationInFrames, durationInSeconds: durationInFrames / fr };
}

export const LottieFrame: React.FC<{
  animationData: LottieData;
  playbackRate: number;
  loop: boolean;
  style?: React.CSSProperties;
  preserveAspectRatio?: string;
}> = ({ animationData, playbackRate, loop, style, preserveAspectRatio = "xMidYMid meet" }) => {
  const frame = useCurrentFrame();
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<AnimationItem | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const anim = lottie.loadAnimation({
      container,
      renderer: "svg",
      loop: false,
      autoplay: false,
      animationData,
      rendererSettings: { preserveAspectRatio },
    });
    animRef.current = anim;
    return () => {
      animRef.current = null;
      anim.destroy();
    };
  }, [animationData, preserveAspectRatio]);

  // Seek every frame (deps deliberately absent — the engine steps frame-by-frame).
  useLayoutEffect(() => {
    const anim = animRef.current;
    if (!anim) return;
    const { durationInFrames } = lottieMeta(animationData);
    const raw = frame * playbackRate;
    const idx = loop ? raw % durationInFrames : Math.min(raw, Math.max(0, durationInFrames - 0.001));
    anim.goToAndStop(idx, true);
  });

  return <div ref={containerRef} style={style} />;
};
