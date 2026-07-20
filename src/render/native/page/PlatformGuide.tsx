import React from "react";
import { AbsoluteFill } from "./runtime";
import type { PlatformGuideKind } from "../../platform.js";

export type { PlatformGuideKind };

const GUIDE: Record<
  PlatformGuideKind,
  { rail: number; bottom: number; top: number; label: string }
> = {
  // Rough in-feed chrome — right icon rail, bottom caption/username, top status.
  tiktok: { rail: 0.12, bottom: 0.18, top: 0.08, label: "TikTok safe zones" },
  reels: { rail: 0.11, bottom: 0.16, top: 0.07, label: "Reels / Shorts safe zones" },
};

/** Translucent in-feed chrome overlay for still/storyboard QA. Not used on `kino build`. */
export const PlatformGuide: React.FC<{ kind: PlatformGuideKind }> = ({ kind }) => {
  const g = GUIDE[kind];
  const zone: React.CSSProperties = {
    position: "absolute",
    background: "rgba(255, 80, 80, 0.28)",
    border: "1px solid rgba(255, 120, 120, 0.55)",
    boxSizing: "border-box",
  };
  return (
    <AbsoluteFill style={{ pointerEvents: "none", zIndex: 50 }}>
      <div style={{ ...zone, top: 0, left: 0, right: 0, height: `${g.top * 100}%` }} />
      <div style={{ ...zone, bottom: 0, left: 0, right: 0, height: `${g.bottom * 100}%` }} />
      <div style={{ ...zone, top: 0, right: 0, bottom: 0, width: `${g.rail * 100}%` }} />
      <div
        style={{
          position: "absolute",
          left: "3%",
          top: "3%",
          padding: "0.6% 1.4%",
          borderRadius: 6,
          background: "rgba(0,0,0,0.65)",
          color: "#fecaca",
          fontSize: 22,
          fontFamily: "Helvetica, Arial, sans-serif",
          fontWeight: 700,
        }}
      >
        {g.label}
      </div>
    </AbsoluteFill>
  );
};
