// Frame-driven primitives for the native render page: frame-indexed sequencing, damped-spring
// easing, piecewise-linear interpolation. Everything is a pure function of the current frame
// (React context), advanced by window.kinoSeek (see index.tsx) — no wall clock anywhere.
import React from "react";

export interface VideoConfig {
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
}

const FrameCtx = React.createContext(0);
const ConfigCtx = React.createContext<VideoConfig>({ fps: 30, width: 1080, height: 1920, durationInFrames: 1 });

export const FrameProvider: React.FC<{ frame: number; config: VideoConfig; children: React.ReactNode }> = ({ frame, config, children }) => (
  <ConfigCtx.Provider value={config}>
    <FrameCtx.Provider value={frame}>{children}</FrameCtx.Provider>
  </ConfigCtx.Provider>
);

export const useCurrentFrame = (): number => React.useContext(FrameCtx);
export const useVideoConfig = (): VideoConfig => React.useContext(ConfigCtx);

// Full-bleed layer: absolute inset-0 flex column (the layout contract every kino layer builds on).
export const AbsoluteFill: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ style, children, ...rest }) => (
  <div
    style={{
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: "100%",
      height: "100%",
      display: "flex",
      flexDirection: "column",
      ...style,
    }}
    {...rest}
  >
    {children}
  </div>
);

// Time-window wrapper: children exist only for frame ∈ [from, from+durationInFrames) and see a
// local clock starting at 0. Wraps children in an AbsoluteFill (the layout the composition expects).
export const Sequence: React.FC<{
  from?: number;
  durationInFrames?: number;
  layout?: "absolute-fill" | "none";
  children: React.ReactNode;
}> = ({ from = 0, durationInFrames = Infinity, layout = "absolute-fill", children }) => {
  const frame = useCurrentFrame();
  if (frame < from || frame >= from + durationInFrames) return null;
  const inner = <FrameCtx.Provider value={frame - from}>{children}</FrameCtx.Provider>;
  return layout === "none" ? inner : <AbsoluteFill>{inner}</AbsoluteFill>;
};

// Clock override: children see a fixed frame while active (freeze-frame holds).
export const Freeze: React.FC<{ frame: number; active?: boolean; children: React.ReactNode }> = ({ frame, active = true, children }) =>
  active ? <FrameCtx.Provider value={frame}>{children}</FrameCtx.Provider> : <>{children}</>;

export const Img: React.FC<React.ImgHTMLAttributes<HTMLImageElement>> = (props) => <img {...props} />;

// Map a publicDir-relative asset path to the local render server URL.
export function staticFile(p: string): string {
  return "/public/" + p.split("/").map(encodeURIComponent).join("/");
}

export { interpolate, Easing, type InterpolateOptions } from "../../interpolate.js";

// --- spring --------------------------------------------------------------------------------------
// Pure frame math, so it lives outside this React module — layers.ts needs it node-side.
export { spring, type SpringConfig } from "../../spring.js";
