import React from "react";
import { Composition } from "remotion";
import { KinoVideo } from "./KinoVideo";
import type { KinoProps } from "../props";

const DEFAULTS: KinoProps = {
  theme: {
    font: "Helvetica, Arial, sans-serif",
    night: "#0b1020",
    mint: "#80e2b4",
    green: "#0c8d64",
    gold: "#d99a20",
    white: "#fff",
    captionFontSize: 74,
    captionStroke: 9,
  },
  fps: 30,
  avatar: null,
  avatarWindows: [],
  voTrack: null,
  logo: null,
  facelessBg: null,
  disclosure: "AI avatar & voice · sample data",
  segments: [],
};

export const RemotionRoot: React.FC = () => (
  <Composition
    id="KinoVideo"
    component={KinoVideo}
    durationInFrames={900}
    fps={30}
    width={1080}
    height={1920}
    defaultProps={DEFAULTS}
    calculateMetadata={({ props }) => {
      const p = props as KinoProps;
      const total = p.segments.length ? Math.max(...p.segments.map((s) => s.endSec)) : 30;
      return { durationInFrames: Math.round(total * p.fps) };
    }}
  />
);
