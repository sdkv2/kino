export type PlatformGuideKind = "tiktok" | "reels";

export function parsePlatform(raw?: string): PlatformGuideKind | undefined {
  if (!raw) return undefined;
  const k = raw.trim().toLowerCase();
  if (k === "tiktok") return "tiktok";
  if (k === "reels" || k === "shorts" || k === "youtube" || k === "yt") return "reels";
  throw new Error(`Unknown --platform '${raw}'. Use: tiktok | reels | shorts`);
}
