import React from "react";
import { AbsoluteFill, Easing, Img, OffthreadVideo, continueRender, delayRender, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme, BackgroundProps, WordTiming, BgKeyframe } from "../props";
import { shotTransform, type Shot, type Transition } from "../motion";
import { activeWordIndex, isHighlightWord, normWord } from "../captions";
import { paramsAt } from "../bgparams";
import { CanvasBackground } from "./backgrounds/CanvasBackground";
import { getPreset, type DrawFn } from "./backgrounds/presets";

const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

// Loads the brand TTF (a downloaded registry font) before rendering, under the family
// "KinoBrandFont" that theme.font references. No-op when using a system font.
export const FontLoader: React.FC<{ url?: string | null }> = ({ url }) => {
  const [handle] = React.useState(() => (url ? delayRender("brand-font") : null));
  React.useEffect(() => {
    if (!url || handle === null) return;
    const ff = new FontFace("KinoBrandFont", `url(${staticFile(url)})`);
    ff.load()
      .then((f) => {
        document.fonts.add(f);
        continueRender(handle);
      })
      .catch(() => continueRender(handle));
  }, [url, handle]);
  return null;
};

// Optional translucent panel behind lower-third captions (legibility over light app screenshots).
// Spread onto the caption element only when a backplate is resolved; otherwise the look is unchanged.
const plateStyle = (bg?: string | null): React.CSSProperties =>
  bg ? { display: "inline-block", backgroundColor: bg, padding: "12px 32px", borderRadius: 30 } : {};

export const Caption: React.FC<{ text: string; t: Theme; backplate?: { bg: string } | null }> = ({ text, t, backplate }) => {
  const f = useCurrentFrame();
  const s = spring({ frame: f, fps: 30, config: { damping: 14, mass: 0.6 } });
  return (
    <div style={{ position: "absolute", left: 48, right: 48, bottom: 470, display: "flex", justifyContent: "center" }}>
      <span
        style={{
          transform: `scale(${interpolate(s, [0, 1], [0.7, 1])})`,
          fontFamily: t.font,
          fontWeight: 900,
          fontSize: t.captionFontSize,
          color: t.white,
          textAlign: "center",
          lineHeight: 1.04,
          whiteSpace: "pre-line",
          WebkitTextStroke: `${t.captionStroke}px #000`,
          paintOrder: "stroke fill" as React.CSSProperties["paintOrder"],
          textShadow: "0 6px 20px rgba(0,0,0,.45)",
          ...plateStyle(backplate?.bg),
        }}
      >
        {text}
      </span>
    </div>
  );
};

// Faceless talking beats: the text IS the visual. Big, centered, word-by-word pop so the
// frame is full and alive instead of a small lower-third line over empty night.
export const HeroCaption: React.FC<{ text: string; t: Theme }> = ({ text, t }) => {
  const f = useCurrentFrame();
  const words = text.split(" ");
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: "0 80px" }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", columnGap: 22, rowGap: 6 }}>
        {words.map((w, i) => {
          const s = spring({ frame: f - i * 3, fps: 30, config: { damping: 13, mass: 0.7 } });
          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                transform: `translateY(${interpolate(s, [0, 1], [44, 0])}px)`,
                opacity: interpolate(s, [0, 1], [0, 1]),
                fontFamily: t.font,
                fontWeight: 900,
                fontSize: Math.round(t.captionFontSize * 1.42),
                color: t.white,
                lineHeight: 1.06,
                WebkitTextStroke: `${t.captionStroke}px #000`,
                paintOrder: "stroke fill" as React.CSSProperties["paintOrder"],
                textShadow: "0 8px 28px rgba(0,0,0,.5)",
              }}
            >
              {w}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// Center scrim that keeps hero text legible over a busy background (derived from the brand night).
const Scrim: React.FC<{ t: Theme }> = ({ t }) => (
  <AbsoluteFill style={{ background: `radial-gradient(ellipse 72% 46% at 50% 50%, ${t.night}bd, ${t.night}38 68%, ${t.night}00)` }} />
);

// Two soft brand glows drifting over night (the zero-config default).
const GlowBg: React.FC<{ t: Theme }> = ({ t }) => {
  const f = useCurrentFrame();
  const dx = Math.sin(f / 60) * 6;
  const dy = Math.cos(f / 80) * 8;
  return (
    <AbsoluteFill style={{ backgroundColor: t.night, overflow: "hidden" }}>
      <div style={{ position: "absolute", top: `${18 + dy}%`, left: `${12 + dx}%`, width: 920, height: 920, borderRadius: "50%", background: `radial-gradient(circle, ${t.green}55, transparent 62%)`, filter: "blur(46px)" }} />
      <div style={{ position: "absolute", bottom: `${8 - dy}%`, right: `${8 + dx}%`, width: 760, height: 760, borderRadius: "50%", background: `radial-gradient(circle, ${t.mint}30, transparent 62%)`, filter: "blur(54px)" }} />
    </AbsoluteFill>
  );
};

// Static brand image with a slow Ken-Burns push-in.
const ImageBg: React.FC<{ src: string; t: Theme }> = ({ src, t }) => {
  const f = useCurrentFrame();
  const scale = interpolate(f, [0, 300], [1.05, 1.13], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ backgroundColor: t.night, overflow: "hidden" }}>
      <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${scale})` }} />
    </AbsoluteFill>
  );
};

// Dispatcher: glow = CSS drift; image = Ken-Burns photo; mesh/aurora/particles/grid = canvas
// presets; custom = the brand's own draw fn. Animated backgrounds get the legibility scrim.
export const FacelessBackdrop: React.FC<{ t: Theme; background: BackgroundProps }> = ({ t, background }) => {
  const { kind, customCode, params, keyframes, triggers, image } = background;
  const draw = React.useMemo<DrawFn | undefined>(() => {
    if (kind === "custom" && customCode) {
      // brand-authored draw fn (trusted, local config), runs per frame inside CanvasBackground
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      return new Function("ctx", "env", customCode) as DrawFn;
    }
    return getPreset(kind);
  }, [kind, customCode]);

  if (kind === "image" && image) {
    return (
      <AbsoluteFill>
        <ImageBg src={staticFile(image)} t={t} />
        <Scrim t={t} />
      </AbsoluteFill>
    );
  }
  if (draw) {
    return (
      <AbsoluteFill>
        <CanvasBackground draw={draw} params={params} keyframes={keyframes} triggers={triggers} t={t} />
        <Scrim t={t} />
      </AbsoluteFill>
    );
  }
  return <GlowBg t={t} />;
};

const numOf = (v: unknown, d: number) => (typeof v === "number" ? v : Number(v) || d);

// Reusable overlay layer: positions children at (x%, y%) anchored at their centre, and tweens
// x/y/scale/opacity from an agent keyframe track (absolute time = fromSec + local frame). With no
// keyframes it does a gentle entrance (when defaultEntrance). Captions/kickers can adopt this too.
export const AnimatedElement: React.FC<{
  x: number;
  y: number;
  keyframes: BgKeyframe[];
  fromSec: number;
  defaultEntrance?: boolean;
  children: React.ReactNode;
}> = ({ x, y, keyframes, fromSec, defaultEntrance, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  let px = x;
  let py = y;
  let scale = 1;
  let opacity = 1;
  if (keyframes.length) {
    const p = paramsAt({ x, y, scale: 1, opacity: 1 }, keyframes, fromSec + frame / fps);
    px = numOf(p.x, x);
    py = numOf(p.y, y);
    scale = numOf(p.scale, 1);
    opacity = numOf(p.opacity, 1);
  } else if (defaultEntrance) {
    const s = spring({ frame, fps, config: { damping: 200 } });
    opacity = s;
    scale = interpolate(s, [0, 1], [0.9, 1]);
  }
  return (
    <div style={{ position: "absolute", left: `${px}%`, top: `${py}%`, transform: `translate(-50%, -50%) scale(${scale})`, opacity }}>
      {children}
    </div>
  );
};

// Tween wrapper for elements that already position themselves (captions, kickers). Keyframes offset
// (x/y as % of frame), scale, and fade them over absolute time. No keyframes → pass-through (no change,
// so the default look is preserved exactly).
export const TweenOverlay: React.FC<{ keyframes: BgKeyframe[]; children: React.ReactNode }> = ({ keyframes, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (!keyframes.length) return <>{children}</>;
  // per-segment elements: `at` is relative to the segment start (local frame)
  const p = paramsAt({ x: 0, y: 0, scale: 1, opacity: 1 }, keyframes, frame / fps);
  return (
    <AbsoluteFill style={{ transform: `translate(${numOf(p.x, 0)}%, ${numOf(p.y, 0)}%) scale(${numOf(p.scale, 1)})`, opacity: numOf(p.opacity, 1) }}>
      {children}
    </AbsoluteFill>
  );
};

// Brand mark for faceless talking beats — configurable size/position, agent-tweenable.
export const Logo: React.FC<{ src: string; sizePx: number; x: number; y: number; keyframes: BgKeyframe[]; fromSec: number }> = ({
  src,
  sizePx,
  x,
  y,
  keyframes,
  fromSec,
}) => (
  <AnimatedElement x={x} y={y} keyframes={keyframes} fromSec={fromSec} defaultEntrance>
    <Img src={src} style={{ width: sizePx }} />
  </AnimatedElement>
);

// Word-synced caption: the spoken words, revealed + highlighted in time with the VO.
// Typewriter reveal (pop/bounce) per word at its start; active word highlighted; emphasised
// words glow + shake. Driven by absolute word timings, so it's frame-deterministic.
export const WordCaption: React.FC<{ words: WordTiming[]; emphasis?: string[]; startSec: number; t: Theme; backplate?: { bg: string } | null }> = ({
  words,
  emphasis = [],
  startSec,
  t,
  backplate,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tAbs = startSec + frame / fps;
  const active = activeWordIndex(words, tAbs);
  const emph = new Set(emphasis.map(normWord));
  const row = (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        columnGap: 18,
        rowGap: 4,
        maxWidth: "100%",
        ...plateStyle(backplate?.bg),
      }}
    >
      {words.map((w, i) => {
        const revealFrame = (tAbs - w.start) * fps;
        const s = spring({ frame: revealFrame, fps, config: { damping: 12, mass: 0.6 } });
        const isActive = i === active;
        const isEmph = emph.has(normWord(w.word));
        // Single highlight colour: the spoken word and the brand name go green. No gold/transition.
        const isGreen = isHighlightWord(w.word, { isActive, brandName: t.brandName });
        const scale = (revealFrame <= 0 ? 0.6 : interpolate(s, [0, 1], [0.6, 1])) * (isActive ? 1.1 : 1);
        const opacity = revealFrame <= 0 ? 0 : interpolate(s, [0, 1], [0, 1]);
        const shake = isActive && isEmph ? Math.sin(frame * 1.4) * 3 : 0;
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              transform: `translateX(${shake}px) scale(${scale})`,
              opacity,
              fontFamily: t.font,
              fontWeight: 900,
              fontSize: Math.round(t.captionFontSize * 0.92),
              color: isGreen ? t.mint : t.white,
              lineHeight: 1.05,
              WebkitTextStroke: `${t.captionStroke}px #000`,
              paintOrder: "stroke fill" as React.CSSProperties["paintOrder"],
              textShadow: isActive && isEmph ? `0 0 26px ${t.mint}` : "0 6px 18px rgba(0,0,0,.45)",
            }}
          >
            {w.word}
          </span>
        );
      })}
    </div>
  );
  return (
    <div style={{ position: "absolute", left: 56, right: 56, bottom: 470, display: "flex", justifyContent: "center" }}>{row}</div>
  );
};

export const Kicker: React.FC<{ text: string; color: string; fg: string; t: Theme }> = ({ text, color, fg, t }) => {
  const f = useCurrentFrame();
  const s = spring({ frame: f, fps: 30, config: { damping: 180 } });
  return (
    <div style={{ position: "absolute", top: 150, left: 0, right: 0, display: "flex", justifyContent: "center", opacity: s }}>
      <span style={{ background: color, color: fg, fontFamily: t.font, fontWeight: 900, fontSize: 36, padding: "13px 24px", borderRadius: 999 }}>
        {text}
      </span>
    </div>
  );
};

export const AppCutaway: React.FC<{ asset: string; dur: number; t: Theme; shot?: Shot; transition?: Transition }> = ({
  asset,
  dur,
  t,
  shot = "static",
  transition = "fade",
}) => {
  const f = useCurrentFrame();
  const p = Math.min(1, f / dur);

  // --- camera move (inner image) --- (pure math in motion.ts; includes scroll/scroll-up)
  const { scale, tx, ty } = shotTransform(shot, p);

  // --- transition (outer layer), CapCut-style: spring "fly in" + settle, quick eased exit ---
  const { fps } = useVideoConfig();
  const ein = spring({ frame: f, fps, config: { damping: 14, stiffness: 130, mass: 0.6 }, durationInFrames: 18 });
  const eIO = Math.min(1, ein); // clamped (no overshoot) for opacity/scale
  const eout = Easing.in(Easing.cubic)(
    interpolate(f, [dur - 7, dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
  );
  let opacity = 1;
  let otx = 0;
  let oty = 0;
  let oscale = 1;
  if (transition === "fly-left") {
    otx = (1 - ein) * 120 + eout * -130; // springs in from the right (slight overshoot), eases off left
    oscale = lerp(1.12, 1.0, eIO); // oversize during entry so the slide never reveals an edge
  } else if (transition === "fly-up") {
    oty = (1 - ein) * 120 + eout * -130;
    oscale = lerp(1.12, 1.0, eIO);
  } else if (transition === "pop") {
    oscale = (0.72 + 0.28 * ein) * (1 - 0.18 * eout); // zoom-punch in (spring overshoot), shrink out
    opacity = Math.min(1, ein * 2) * (1 - eout);
  } else if (transition === "fade") {
    opacity = eIO * (1 - eout);
  }
  // "cut": no entrance/exit animation

  const isVideo = asset.toLowerCase().endsWith(".mp4") || asset.toLowerCase().endsWith(".mov");
  return (
    <AbsoluteFill style={{ backgroundColor: t.night, opacity, transform: `translate(${otx}%, ${oty}%) scale(${oscale})` }}>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", overflow: "hidden" }}>
        {isVideo ? (
          <OffthreadVideo src={staticFile(asset)} style={{ width: 1080, transform: `translate(${tx}%, ${ty}%) scale(${scale})` }} />
        ) : (
          <Img src={staticFile(asset)} style={{ width: 1080, transform: `translate(${tx}%, ${ty}%) scale(${scale})` }} />
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const Disclosure: React.FC<{ text: string; t: Theme }> = ({ text, t }) => (
  <div
    style={{
      position: "absolute",
      bottom: 30,
      left: 0,
      right: 0,
      textAlign: "center",
      color: "rgba(255,255,255,.5)",
      fontFamily: t.font,
      fontWeight: 700,
      fontSize: 21,
      textShadow: "0 2px 6px rgba(0,0,0,.6)",
    }}
  >
    {text}
  </div>
);
