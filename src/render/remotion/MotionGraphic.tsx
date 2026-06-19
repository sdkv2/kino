import React, { useLayoutEffect, useRef } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme, MotionGraphicProps, MotionEnv } from "../props";
import { paramsAt, pulseAt } from "../bgparams";
import { buildMotionVars } from "../motionVars";
import { sanitizeMotionHtml } from "../sanitizeMotion";
import { Lottie, getLottieMetadata } from "@remotion/lottie";
import { lottiePlaybackRate } from "../lottie";

// Trusted stylesheet injected into every motion-graphic shadow root:
//  • pause ALL animations so none run on the wall clock (determinism), and scrub elements marked
//    `.kino-anim` across the beat via a --progress-driven negative animation-delay (the canonical
//    Remotion scrub). Inert when the agent's HTML defines no animations. --kino-delay (agent-set,
//    default 0) staggers; sub-timing lives in the @keyframes % stops; easing is the agent's.
//  • `.kino-cliptext` helper: gradient text via `background-clip:text` paints the gradient only over
//    the content box, so glyph ink that negative letter-spacing pushes past that box renders
//    transparent (the last glyph's edge looks sliced). This widens the paint box with inline padding,
//    cancelled by equal negative margin so layout/centering is unchanged. Opt-in (a CSS selector
//    can't match computed background-clip, and blanket padding would break margin:auto / tight runs).
const KINO_SCRUB_STYLE =
  "<style>*{animation-play-state:paused !important;transition:none !important}" +
  ".kino-anim{animation-duration:1s !important;animation-fill-mode:both !important;" +
  "animation-iteration-count:1 !important;" +
  "animation-delay:calc((var(--progress) - var(--kino-delay, 0)) * -1s) !important}" +
  ".kino-cliptext{padding-inline:.12em;margin-inline:-.12em}</style>";

// Inject the sanitized HTML into a Shadow root, then set CSS custom properties on the host every
// frame. Custom properties inherit across the shadow boundary, so the agent's (shadow-scoped) CSS
// reads --frame/--t/--progress/--pulse/--<param> and the brand palette. useLayoutEffect runs sync,
// pre-paint, so Remotion captures a deterministic frame (same pattern as CanvasBackground).
const ShadowHtml: React.FC<{ html: string; vars: Record<string, string> }> = ({ html, vars }) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<ShadowRoot | null>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!shadowRef.current) shadowRef.current = host.attachShadow({ mode: "open" });
    shadowRef.current.innerHTML = KINO_SCRUB_STYLE + html;
  }, [html]);

  // Intentional: this re-runs on the frame-derived inputs to redraw every frame. The dep array is
  // deliberate (Remotion advances frame-by-frame); it is NOT a missing-deps bug — do not add a [].
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    for (const [k, v] of Object.entries(vars)) host.style.setProperty(k, v);
  });

  return <div ref={hostRef} style={{ position: "absolute", inset: 0 }} />;
};

// Full-frame motion-graphic layer. durationFrames maps --progress 0→1 across the beat.
export const MotionGraphic: React.FC<{ data: MotionGraphicProps; durationFrames: number; t: Theme; captionBottom?: number }> = ({
  data,
  durationFrames,
  t,
  captionBottom,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const tt = frame / fps;
  const resolved = paramsAt(data.params, data.keyframes, tt);
  const pulse = pulseAt(data.triggers, tt);
  const progress = durationFrames > 0 ? Math.min(1, Math.max(0, frame / durationFrames)) : 0;

  const vars = buildMotionVars(t, { frame, t: tt, progress, pulse, params: resolved, captionBottom });

  // Tier 2: a procedural source is the body of render(env); memoize the compiled fn and evaluate it
  // for this frame. It runs in the browser (no Node globals) and must be a pure (env) → HTML string.
  const procFn = React.useMemo(
    () =>
      data.proc && !data.lottie
        ? // TRUST BOUNDARY: new Function() executes config-supplied code. This is safe ONLY because the
          // source is trusted local project config that has already passed the sanitize + determinism lint
          // (sanitize: src/render/sanitizeMotion.ts; lint: src/render/motiongraphic.ts). Never feed untrusted/remote input here.
          // eslint-disable-next-line @typescript-eslint/no-implied-eval
          (new Function("env", data.proc) as (env: MotionEnv) => unknown)
        : null,
    [data.proc, data.lottie],
  );
  let html = data.html;
  if (procFn) {
    const env: MotionEnv = {
      frame,
      t: tt,
      progress,
      pulse,
      params: resolved,
      palette: { mint: t.mint, green: t.green, night: t.night, white: t.white, gold: t.gold, font: t.font },
      width,
      height,
    };
    try {
      // Sanitize the per-frame procedural output: it goes straight to innerHTML, so unlike the static
      // .html (sanitized once at resolve time) its markup is dynamic and could smuggle event handlers.
      html = sanitizeMotionHtml(String(procFn(env) ?? ""));
    } catch (err) {
      html = "";
      if (frame === 0) console.error("motion graphic render(env) threw:", err);
    }
  }

  // Tier 3: a Lottie graphic renders via @remotion/lottie, which advances the animation off
  // useCurrentFrame() (deterministic, like the rest of the pipeline). Returned AFTER all hooks above
  // so rules-of-hooks holds; procFn is short-circuited to null for Lottie, so the html/env work above
  // is inert here. playbackRate stretches the full animation once across the beat (loop=false).
  if (data.lottie) {
    const animationData = data.lottie as Parameters<typeof getLottieMetadata>[0];
    const loop = data.loop ?? false;
    const meta = getLottieMetadata(animationData);
    if (!meta && frame === 0) console.warn("Lottie metadata unavailable — playing at native speed");
    const playbackRate = meta ? lottiePlaybackRate(meta.durationInFrames, durationFrames, loop) : 1;
    return (
      <AbsoluteFill>
        <Lottie
          animationData={animationData}
          loop={loop}
          playbackRate={playbackRate}
          preserveAspectRatio="xMidYMid meet"
          style={{ width: "100%", height: "100%" }}
        />
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill>
      <ShadowHtml html={html} vars={vars} />
    </AbsoluteFill>
  );
};
