import React from "react";
import { AbsoluteFill, Img, OffthreadVideo, interpolate, spring, staticFile, useCurrentFrame } from "remotion";
import type { Theme } from "../props";

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

export const AppCutaway: React.FC<{ asset: string; dur: number; t: Theme }> = ({ asset, dur, t }) => {
  const f = useCurrentFrame();
  const sc = interpolate(Math.min(1, f / dur), [0, 1], [1.04, 1.12]);
  const intro = interpolate(f, [0, 6], [0, 1], { extrapolateRight: "clamp" });
  const isVideo = asset.toLowerCase().endsWith(".mp4") || asset.toLowerCase().endsWith(".mov");
  return (
    <AbsoluteFill style={{ backgroundColor: t.night, opacity: intro }}>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", overflow: "hidden" }}>
        {isVideo ? (
          <OffthreadVideo src={staticFile(asset)} style={{ width: 1080, transform: `scale(${sc})` }} />
        ) : (
          <Img src={staticFile(asset)} style={{ width: 1080, transform: `scale(${sc})` }} />
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
