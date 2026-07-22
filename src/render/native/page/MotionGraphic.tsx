// Native-engine port of the motion-graphic layer. The scrub stylesheet, SVG defs, shadow-DOM
// injection, Tier-2 evaluation and Tier-3 timing math are identical to the legacy composition —
// only the frame plumbing (./runtime) and the Lottie player (lottie-web via ./lottie) differ.
import React, { useLayoutEffect, useRef } from "react";
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from "./runtime";
import type { Theme, MotionGraphicProps, MotionEnv } from "../../props.js";
import { paramsAt, pulseAt } from "../../bgparams.js";
import { buildMotionEnv } from "../../motionEnv.js";
import { buildMotionVars, wordsShownAt } from "../../motionVars.js";
import { KINO_SCRUB_STYLE, KINO_DEFS } from "../../motionCss.js";
import { sanitizeMotionHtml } from "../../sanitizeMotion.js";
import { lottiePlaybackRate } from "../../lottie.js";
import { LottieFrame, lottieMeta } from "./lottie";
import { SceneFrames } from "./SceneFrames";

// Inject the sanitized HTML into a Shadow root, then set CSS custom properties on the host every
// frame. Custom properties inherit across the shadow boundary, so the agent's (shadow-scoped) CSS
// reads --frame/--t/--progress/--pulse/--<param> and the brand palette. useLayoutEffect runs sync
// inside the flushSync seek, so the screenshot captures a deterministic frame.
const ShadowHtml: React.FC<{ html: string; vars: Record<string, string> }> = ({ html, vars }) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<ShadowRoot | null>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!shadowRef.current) shadowRef.current = host.attachShadow({ mode: "open" });
    shadowRef.current.innerHTML = KINO_SCRUB_STYLE + KINO_DEFS + html;
  }, [html]);

  // Intentional: this re-runs on the frame-derived inputs to redraw every frame. The dep array is
  // deliberate (the engine advances frame-by-frame); it is NOT a missing-deps bug — do not add a [].
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
  const resolved = paramsAt(data.params, data.keyframes, tt, { implicitBase: true });
  const pulse = pulseAt(data.triggers, tt);
  const progress = durationFrames > 0 ? Math.min(1, Math.max(0, frame / durationFrames)) : 0;

  const words = data.words ?? [];
  const wordsShown = wordsShownAt(words, tt);
  const vars = buildMotionVars(t, {
    frame,
    t: tt,
    progress,
    pulse,
    params: resolved,
    captionBottom,
    wordsShown,
    wordCount: words.length,
  });

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

  if (data.sceneFrames) {
    return <SceneFrames frames={data.sceneFrames} />;
  }

  let html = data.html;
  if (procFn) {
    const env = buildMotionEnv({ frame, fps, width, height, durationFrames, data, t });
    try {
      // Sanitize the per-frame procedural output: it goes straight to innerHTML, so unlike the static
      // .html (sanitized once at resolve time) its markup is dynamic and could smuggle event handlers.
      html = sanitizeMotionHtml(String(procFn(env) ?? ""));
    } catch (err) {
      html = "";
      if (frame === 0) console.error("motion graphic render(env) threw:", err);
    }
  }

  // Tier 3: Lottie — seeked per frame off the composition clock (deterministic). playbackRate
  // stretches the full animation once across the beat (loop=false); see lottiePlaybackRate.
  if (data.lottie) {
    const meta = lottieMeta(data.lottie);

    // Fire mode: when the graphic carries triggers (authored at VO word times via `kino inspect`),
    // each trigger pops a fresh one-shot of the animation, so the Lottie moves in time with the words.
    // A nested <Sequence from={wordFrame}> restarts the inner clock at the trigger (beat-local), and
    // LottieFrame seeks off that clock. `loop` is ignored here (each burst is one-shot). Bursts may
    // overlap if words land closer than the burst length, so author short, transparent burst assets.
    if (data.triggers && data.triggers.length > 0) {
      const burstFrames = Math.max(1, Math.round(meta.durationInSeconds * fps));
      const burstRate = lottiePlaybackRate(meta.durationInFrames, burstFrames, false);
      return (
        <AbsoluteFill>
          {data.triggers.map((tr, i) => (
            <Sequence key={i} from={Math.round(tr.at * fps)} durationInFrames={burstFrames}>
              <LottieFrame
                animationData={data.lottie!}
                loop={false}
                playbackRate={burstRate}
                preserveAspectRatio="xMidYMid meet"
                style={{ width: "100%", height: "100%" }}
              />
            </Sequence>
          ))}
        </AbsoluteFill>
      );
    }

    const loop = data.loop ?? false;
    const playbackRate = lottiePlaybackRate(meta.durationInFrames, durationFrames, loop);
    return (
      <AbsoluteFill>
        <LottieFrame
          animationData={data.lottie}
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
