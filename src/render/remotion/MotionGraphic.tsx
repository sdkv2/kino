import React, { useLayoutEffect, useRef } from "react";
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme, MotionGraphicProps, MotionEnv } from "../props";
import { paramsAt, pulseAt } from "../bgparams";
import { buildMotionVars } from "../motionVars";
import { sanitizeMotionHtml } from "../sanitizeMotion";
import { Lottie, getLottieMetadata } from "@remotion/lottie";
import { lottiePlaybackRate } from "../lottie";

// Trusted stylesheet injected into every motion-graphic shadow root. All of it is determinism-safe:
// animations are force-paused and scrubbed by --progress (no wall clock), helpers read frame-driven
// vars only, and there are no transitions / external url()s. Opt-in `.kino-*` utilities so an agent
// reaches for polished motion without re-deriving it:
//  • Scrub: pause ALL animations, then seek elements in the scrub set (`.kino-anim` + the built-in
//    reveals below) to --progress via a negative animation-delay (the canonical Remotion scrub).
//    --kino-delay (agent-set, default 0) staggers; sub-timing lives in the @keyframes % stops.
//  • Easing tokens (`--kino-ease-out/-in-out/-overshoot/-spring`): cubic-beziers matching the spec's
//    keyframe eases, for `animation-timing-function:var(--kino-ease-…)` in any @keyframes.
//  • One-class reveals (`.kino-rise/.kino-blur-rise/.kino-pop/.kino-wipe`): complete in the first ~third
//    of the beat then hold — no @keyframes to author. Compose with --kino-delay for staggered lists.
//  • `.kino-pulse`: maps the word-trigger envelope --pulse → a pop (opacity + scale). Pairs with spec
//    triggers `{ at, action:"pulse" }` placed at VO word times (kino inspect).
//  • `.kino-cliptext`: widens the paint box of `background-clip:text` so tight/negative letter-spacing
//    doesn't slice the last glyph's gradient edge (cancelled by equal negative margin → layout unchanged).
//  • `.kino-fade-edges`: a top/bottom mask gradient to feather scrolling / overflowing content.
//  • Texture & finish: `.kino-grain` (film-grain overlay via the injected #kino-grain feTurbulence
//    filter), `.kino-vignette` (edge darken), `.kino-mesh` (soft palette mesh background),
//    `.kino-shadow` (soft drop-shadow). Plus the injected SVG defs in KINO_DEFS that an agent can apply
//    directly: `filter:url(#kino-grain)` and `filter:url(#kino-displace)` (organic edge wobble). The
//    filters are static + seeded → identical every frame (deterministic); `url(#…)` fragment refs pass
//    the lint (only external/relative url()s are rejected).
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
  "@keyframes kino-pop{0%{opacity:0;transform:scale(.7)}40%{opacity:1;transform:scale(1)}100%{opacity:1;transform:scale(1)}}" +
  "@keyframes kino-wipe{0%{clip-path:inset(0 100% 0 0)}40%{clip-path:inset(0 0 0 0)}100%{clip-path:inset(0 0 0 0)}}" +
  ".kino-pulse{opacity:var(--pulse,0);transform:scale(calc(.86 + var(--pulse,0) * .16))}" +
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

// Injected SVG filter library (trusted, alongside KINO_SCRUB_STYLE). The genuinely SVG-only effects —
// noise has no CSS equivalent, and feDisplacementMap gives an organic hand-drawn edge wobble. Static +
// seeded → identical every frame (deterministic). Referenced from agent CSS via filter:url(#kino-…); the
// hidden <svg> just hosts the <defs> so those fragment ids resolve inside the shadow root.
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
// reads --frame/--t/--progress/--pulse/--<param> and the brand palette. useLayoutEffect runs sync,
// pre-paint, so Remotion captures a deterministic frame (same pattern as CanvasBackground).
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
    const meta = getLottieMetadata(animationData);
    if (!meta && frame === 0) console.warn("Lottie metadata unavailable — playing at native speed");

    // Fire mode: when the graphic carries triggers (authored at VO word times via `kino inspect`),
    // each trigger pops a fresh one-shot of the animation, so the Lottie moves in time with the words.
    // A nested <Sequence from={wordFrame}> restarts the inner clock at the trigger (beat-local), and
    // @remotion/lottie advances off that clock — deterministic, no imperative seeking. `loop` is ignored
    // here (each burst is one-shot). Each burst plays once at its native wall-clock duration; bursts may
    // overlap if words land closer than the burst length, so author short, transparent burst assets.
    if (data.triggers && data.triggers.length > 0) {
      const burstFrames = Math.max(1, Math.round((meta?.durationInSeconds ?? 1) * fps));
      const burstRate = meta ? lottiePlaybackRate(meta.durationInFrames, burstFrames, false) : 1;
      return (
        <AbsoluteFill>
          {data.triggers.map((tr, i) => (
            <Sequence key={i} from={Math.round(tr.at * fps)} durationInFrames={burstFrames}>
              <Lottie
                animationData={animationData}
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
