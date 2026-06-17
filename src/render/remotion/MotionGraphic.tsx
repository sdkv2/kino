import React, { useLayoutEffect, useRef } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme, MotionGraphicProps } from "../props";
import { paramsAt, pulseAt } from "../bgparams";

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
  "<style>*{animation-play-state:paused !important}" +
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

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    for (const [k, v] of Object.entries(vars)) host.style.setProperty(k, v);
  });

  return <div ref={hostRef} style={{ position: "absolute", inset: 0 }} />;
};

// Full-frame motion-graphic layer. durationFrames maps --progress 0→1 across the beat.
export const MotionGraphic: React.FC<{ data: MotionGraphicProps; durationFrames: number; t: Theme }> = ({
  data,
  durationFrames,
  t,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tt = frame / fps;
  const resolved = paramsAt(data.params, data.keyframes, tt);
  const pulse = pulseAt(data.triggers, tt);
  const progress = durationFrames > 0 ? Math.min(1, Math.max(0, frame / durationFrames)) : 0;

  const vars: Record<string, string> = {
    "--frame": String(frame),
    "--t": tt.toFixed(4),
    "--progress": progress.toFixed(4),
    "--pulse": pulse.toFixed(4),
    "--kino-green": t.green,
    "--kino-night": t.night,
    "--kino-white": t.white,
    "--kino-mint": t.mint,
    "--kino-font": t.font,
  };
  for (const [k, v] of Object.entries(resolved)) vars[`--${k}`] = String(v);

  return (
    <AbsoluteFill>
      <ShadowHtml html={data.html} vars={vars} />
    </AbsoluteFill>
  );
};
