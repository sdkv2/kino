// Shared prop types for the Remotion composition. Lives in compiled-land so both the
// CLI (render.ts, build.ts) and the Remotion .tsx (bundled by esbuild) can import it.
export interface Theme {
  font: string;
  fontUrl?: string | null; // staticFile-relative TTF to load (registry font), else system font
  night: string;
  mint: string;
  green: string;
  gold: string;
  white: string;
  captionFontSize: number;
  captionStroke: number;
}

// One spoken word and its absolute on-timeline span (from the VO timestamps).
export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

export interface KinoSegment {
  kind: "avatar" | "app";
  asset?: string;
  caption: string;
  startSec: number;
  endSec: number;
  kicker?: { text: string; color: string; fg: string };
  shot?: string; // resolved camera shot (see render/motion)
  transition?: string; // resolved in/out transition for app cut-ins
  captionMode?: "phrase" | "words"; // "words" = spoken text revealed word-by-word, synced to VO
  words?: WordTiming[]; // absolute word timings (present for captionMode "words")
  emphasis?: string[]; // words to emphasise (glow/pop) in "words" mode
}

// Where an avatar clip sits on the main timeline + which slice of the (trimmed) clip to play.
export interface AvatarWindow {
  fromSec: number; // main-timeline start
  toSec: number; // main-timeline end
  audioStartSec: number; // offset into the trimmed avatar clip
}

// Faceless background selection, resolved at build time.
export interface BackgroundProps {
  kind: "glow" | "image" | "mesh" | "aurora" | "particles" | "grid" | "custom";
  image: string | null; // staticFile-relative path, for kind="image"
  customCode: string | null; // draw-fn source, for kind="custom"
  colors: string[]; // palette for animated backgrounds
  intensity: number; // 0..1 motion strength
}

export interface KinoProps {
  theme: Theme;
  fps: number;
  avatar: string | null; // staticFile-relative path to the (trimmed) avatar clip, or null for faceless
  avatarWindows: AvatarWindow[]; // placements of the avatar clip; empty when faceless
  voTrack: string | null; // staticFile-relative path to the full VO audio track
  logo: string | null; // staticFile-relative brand mark, shown on faceless talking beats
  background: BackgroundProps; // faceless background engine selection
  disclosure: string;
  segments: KinoSegment[];
}
