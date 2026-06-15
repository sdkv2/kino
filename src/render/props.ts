// Shared prop types for the Remotion composition. Lives in compiled-land so both the
// CLI (render.ts, build.ts) and the Remotion .tsx (bundled by esbuild) can import it.
export interface Theme {
  font: string;
  night: string;
  mint: string;
  green: string;
  gold: string;
  white: string;
  captionFontSize: number;
  captionStroke: number;
}

export interface KinoSegment {
  kind: "avatar" | "app";
  asset?: string;
  caption: string;
  startSec: number;
  endSec: number;
  kicker?: { text: string; color: string; fg: string };
}

export interface KinoProps {
  theme: Theme;
  fps: number;
  avatar: string | null; // staticFile-relative path, or null for no-avatar
  disclosure: string;
  segments: KinoSegment[];
}
