// Pexels stock-video search + download (pexels.com/api — free key, PEXELS_API_KEY in .env).
// Search is a thin fetch; file selection is pure logic so it's testable: pickFile() chooses the
// smallest mp4 that still covers the render width (1080), else the largest available.
import { download } from "./net.js";

export interface PexelsVideoFile {
  link: string;
  width: number;
  height: number;
  file_type: string;
  quality: string | null;
}

export interface PexelsVideo {
  id: number;
  duration: number; // seconds
  image: string; // static thumbnail JPG — screen composition/mood before downloading the mp4
  user: { name: string };
  video_files: PexelsVideoFile[];
}

export type Orientation = "portrait" | "landscape";

const API = "https://api.pexels.com/videos/search";

export function searchUrl(query: string, orientation: Orientation, perPage: number): string {
  const u = new URL(API);
  u.searchParams.set("query", query);
  u.searchParams.set("orientation", orientation);
  u.searchParams.set("per_page", String(perPage));
  return u.toString();
}

export function parseVideos(body: unknown): PexelsVideo[] {
  const videos = (body as { videos?: unknown[] })?.videos;
  if (!Array.isArray(videos)) throw new Error("Unexpected Pexels response (no videos array)");
  return videos as PexelsVideo[];
}

export async function searchVideos(
  query: string,
  opts: { apiKey: string; orientation?: Orientation; perPage?: number },
): Promise<PexelsVideo[]> {
  const res = await fetch(searchUrl(query, opts.orientation ?? "portrait", opts.perPage ?? 8), {
    headers: { Authorization: opts.apiKey },
  });
  if (!res.ok) throw new Error(`Pexels search failed: ${res.status} ${res.statusText}`);
  return parseVideos(await res.json());
}

// The composition renders app cut-ins at width 1080 — pick the smallest mp4 that still covers it
// (no wasted download), else the largest one available.
export function pickFile(v: PexelsVideo, targetWidth = 1080): PexelsVideoFile | null {
  const mp4s = v.video_files.filter((f) => f.file_type === "video/mp4" && f.width > 0);
  if (mp4s.length === 0) return null;
  const covering = mp4s.filter((f) => f.width >= targetWidth).sort((a, b) => a.width - b.width);
  return covering[0] ?? mp4s.sort((a, b) => b.width - a.width)[0];
}

export async function downloadVideo(v: PexelsVideo, out: string): Promise<void> {
  const file = pickFile(v);
  if (!file) throw new Error(`Pexels video ${v.id} has no downloadable mp4`);
  await download(file.link, out);
}
