import React from "react";
import { AbsoluteFill, Img, OffthreadVideo, interpolate, spring, staticFile, useCurrentFrame } from "remotion";
import type { Theme } from "../props";
import type { Shot, Transition } from "../motion";

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

  // --- transition in/out (outer layer), punchy ~6 frames ---
  const TR = 6;
  const inP = interpolate(f, [0, TR], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const outP = interpolate(f, [dur - TR, dur], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  let opacity = 1;
  let otx = 0;
  let oty = 0;
  let clipPath: string | undefined;
  if (transition === "fade") opacity = Math.min(inP, outP);
  else if (transition === "slide-left") otx = (1 - inP) * 100 + (1 - outP) * -100;
  else if (transition === "slide-up") oty = (1 - inP) * 100 + (1 - outP) * -100;
  else if (transition === "wipe") {
    const w = Math.min(inP, outP);
    clipPath = `inset(0 ${(1 - w) * 100}% 0 0)`;
  }
  // "cut": no entrance/exit animation

  const isVideo = asset.toLowerCase().endsWith(".mp4") || asset.toLowerCase().endsWith(".mov");
  return (
    <AbsoluteFill style={{ backgroundColor: t.night, opacity, transform: `translate(${otx}%, ${oty}%)`, clipPath }}>
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
