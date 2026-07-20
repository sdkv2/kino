// Pre-extracted video frames, served by the render server under /vframes/<dir>/<file>. The node
// side extracts one image per composition-local frame for every video usage (avatar windows, app
// cut-in beats) — see ../videoFrames.ts — so a <video> element (whose seeking is not frame-exact)
// never appears in the page. Keyed by usage: "av<i>" per avatar window, "seg<i>" per app segment.
import React from "react";
import { useCurrentFrame } from "./runtime";

export interface MediaEntry {
  dir: string; // subdir under /vframes
  byFrame: Record<number, string>; // effective local frame → image name (dense for video renders, sparse for stills)
  maxFrame: number; // largest populated index; overruns (EOF / freeze) clamp here = hold last frame
}

export type MediaMap = Record<string, MediaEntry>;

const MediaCtx = React.createContext<MediaMap>({});

export const MediaProvider: React.FC<{ media: MediaMap; children: React.ReactNode }> = ({ media, children }) => (
  <MediaCtx.Provider value={media}>{children}</MediaCtx.Provider>
);

/** The exact source frame for this composition-local frame (Freeze upstream pins the clock). */
export const FrameVideo: React.FC<{ mediaKey: string; style?: React.CSSProperties }> = ({ mediaKey, style }) => {
  const frame = useCurrentFrame();
  const media = React.useContext(MediaCtx)[mediaKey];
  if (!media) return null;
  const idx = Math.min(Math.max(0, frame), media.maxFrame);
  const file = media.byFrame[idx];
  if (!file) return null;
  return <img src={`/vframes/${media.dir}/${file}`} style={style} />;
};
