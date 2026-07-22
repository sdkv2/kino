// Native-engine port of the motion-graphic layer. The scrub stylesheet, SVG defs, shadow-DOM
// injection, Tier-2 evaluation and Tier-3 timing math are identical to the legacy composition —
// only the frame plumbing (./runtime) and the Lottie player (lottie-web via ./lottie) differ.
import React, { useLayoutEffect, useRef } from "react";
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from "./runtime";
import type { Theme, MotionGraphicProps, MotionEnv } from "../../props.js";
import { paramsAt, pulseAt, progressCurves } from "../../bgparams.js";
import { buildMotionVars, wordsShownAt } from "../../motionVars.js";
import { sanitizeMotionHtml } from "../../sanitizeMotion.js";
import { lottiePlaybackRate } from "../../lottie.js";
import { LottieFrame, lottieMeta } from "./lottie";

// Trusted stylesheet injected into every motion-graphic shadow root. All of it is determinism-safe:
// animations are force-paused and scrubbed by --progress (no wall clock), helpers read frame-driven
// vars only, and there are no transitions / external url()s. This is the canonical injection the
// motion-graphic contract (docs/motion-graphics.md, `kino motion`) documents — same bytes, same pixels.
const KINO_SCRUB_STYLE =
  "<style>*{animation-play-state:paused !important;transition:none !important}" +
  ":host{--kino-ease-out:cubic-bezier(.22,1,.36,1);--kino-ease-in-out:cubic-bezier(.65,0,.35,1);" +
  "--kino-ease-overshoot:cubic-bezier(.34,1.56,.64,1);--kino-ease-spring:cubic-bezier(.22,1.4,.3,1)}" +
  ".kino-anim,.kino-rise,.kino-blur-rise,.kino-pop,.kino-wipe{animation-duration:1s !important;" +
  "animation-fill-mode:both !important;animation-iteration-count:1 !important;" +
  "animation-delay:calc((var(--progress) - var(--kino-delay, 0)) * -1s) !important}" +
  ".kino-rise{animation-name:kino-rise;animation-timing-function:var(--kino-ease-out)}" +
  ".kino-blur-rise{animation-name:kino-blur-rise;animation-timing-function:var(--kino-ease-out)}" +
  ".kino-pop{animation-name:kino-pop;animation-timing-function:var(--kino-ease-overshoot)}" +
  ".kino-wipe{animation-name:kino-wipe;animation-timing-function:var(--kino-ease-in-out)}" +
  "@keyframes kino-rise{0%{opacity:0;transform:translateY(var(--kino-rise-y,42px))}35%{opacity:1;transform:none}100%{opacity:1;transform:none}}" +
  "@keyframes kino-blur-rise{0%{opacity:0;filter:blur(16px);transform:translateY(26px)}45%{opacity:1;filter:blur(0);transform:none}100%{opacity:1;filter:blur(0);transform:none}}" +
  "@keyframes kino-pop{0%{opacity:0;transform:scale(.7)}40%{opacity:1;transform:scale(1.08)}70%{transform:scale(1)}100%{opacity:1;transform:scale(1)}}" +
  "@keyframes kino-wipe{0%{clip-path:inset(0 100% 0 0)}40%{clip-path:inset(0 0 0 0)}100%{clip-path:inset(0 0 0 0)}}" +
  ".kino-pulse{opacity:var(--pulse,0);transform:scale(calc(.88 + var(--pulse,0) * .18))}" +
  ".kino-cliptext{padding-inline:.12em;margin-inline:-.12em}" +
  ".kino-fade-edges{-webkit-mask-image:linear-gradient(180deg,transparent,#000 7%,#000 93%,transparent);" +
  "mask-image:linear-gradient(180deg,transparent,#000 7%,#000 93%,transparent)}" +
  ".kino-grain{position:absolute;inset:0;pointer-events:none;filter:url(#kino-grain);" +
  "opacity:.5;mix-blend-mode:overlay}" +
  ".kino-vignette{position:absolute;inset:0;pointer-events:none;" +
  "background:radial-gradient(75% 70% at 50% 50%,transparent 42%,rgba(0,0,0,.55) 100%)}" +
  ".kino-mesh{background:radial-gradient(60% 60% at 18% 22%,var(--kino-mint),transparent 60%)," +
  "radial-gradient(55% 55% at 82% 28%,var(--kino-gold),transparent 60%)," +
  "radial-gradient(70% 70% at 50% 92%,var(--kino-green),transparent 65%),var(--kino-night)}" +
  ".kino-shadow{filter:drop-shadow(0 12px 26px rgba(0,0,0,.32))}</style>";

// Injected SVG filter library (trusted, alongside KINO_SCRUB_STYLE). Static + seeded → identical
// every frame (deterministic). Referenced from agent CSS via filter:url(#kino-…).
const KINO_DEFS =
  '<svg width="0" height="0" aria-hidden="true" style="position:absolute">' +
  '<filter id="kino-grain" x="0" y="0" width="100%" height="100%">' +
  '<feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="11" stitchTiles="stitch"/>' +
  '<feColorMatrix type="saturate" values="0"/></filter>' +
  '<filter id="kino-displace" x="-10%" y="-10%" width="120%" height="120%">' +
  '<feTurbulence type="fractalNoise" baseFrequency="0.01 0.014" numOctaves="2" seed="3" result="t"/>' +
  '<feDisplacementMap in="SourceGraphic" in2="t" scale="20" xChannelSelector="R" yChannelSelector="G"/></filter>' +
  "</svg>";

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
  const curves = progressCurves(progress);

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
  let html = data.html;
  if (procFn) {
    const env: MotionEnv = {
      frame,
      t: tt,
      progress,
      out: curves.out,
      inout: curves.inout,
      overshoot: curves.overshoot,
      spring: curves.spring,
      edge: curves.edge,
      pulse,
      params: resolved,
      palette: { mint: t.mint, green: t.green, night: t.night, white: t.white, gold: t.gold, font: t.font },
      width,
      height,
      words,
      durationFrames,
      duration: fps > 0 ? durationFrames / fps : 0,
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
