import React from "react";
import { AbsoluteFill, Easing, Img, OffthreadVideo, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme, BackgroundProps } from "../props";
import type { Shot, Transition } from "../motion";
import { CanvasBackground } from "./backgrounds/CanvasBackground";
import { getPreset, type DrawFn } from "./backgrounds/presets";

const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

export const Caption: React.FC<{ text: string; t: Theme }> = ({ text, t }) => {
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
  const { kind, customCode, colors, intensity, image } = background;
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
        <CanvasBackground draw={draw} colors={colors} intensity={intensity} t={t} />
        <Scrim t={t} />
      </AbsoluteFill>
    );
  }
  return <GlowBg t={t} />;
};

// Brand mark for faceless talking beats — top-center, gentle fade/scale in.
export const Logo: React.FC<{ src: string }> = ({ src }) => {
  const f = useCurrentFrame();
  const s = spring({ frame: f, fps: 30, config: { damping: 200 } });
  return (
    <div style={{ position: "absolute", top: 150, left: 0, right: 0, display: "flex", justifyContent: "center", opacity: s }}>
      <Img src={src} style={{ width: 150, transform: `scale(${interpolate(s, [0, 1], [0.9, 1])})` }} />
    </div>
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

  // --- camera move (inner image) ---
  let scale = 1.1;
  let tx = 0;
  let ty = 0;
  if (shot === "push-in") scale = lerp(1.06, 1.2, p);
  else if (shot === "pull-out") scale = lerp(1.2, 1.06, p);
  else if (shot === "pan-left") { scale = 1.14; tx = lerp(5, -5, p); }
  else if (shot === "pan-right") { scale = 1.14; tx = lerp(-5, 5, p); }
  else if (shot === "tilt-up") { scale = 1.14; ty = lerp(5, -5, p); }

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
