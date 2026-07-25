// Pexels stock search + download (pexels.com/api — free key, PEXELS_API_KEY in .env).
// Videos: /videos/search. Photos: /v1/search. File/URL selection is pure + testable.
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

export interface PexelsPhotoSrc {
  original: string;
  large2x: string;
  large: string;
  medium: string;
  small: string;
  portrait: string;
  landscape: string;
  tiny: string;
}

export interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  alt: string;
  photographer: string;
  src: PexelsPhotoSrc;
}

export type Orientation = "portrait" | "landscape";

const VIDEO_API = "https://api.pexels.com/videos/search";
const PHOTO_API = "https://api.pexels.com/v1/search";

export function searchUrl(query: string, orientation: Orientation, perPage: number): string {
  const u = new URL(VIDEO_API);
  u.searchParams.set("query", query);
  u.searchParams.set("orientation", orientation);
  u.searchParams.set("per_page", String(perPage));
  return u.toString();
}

export function photoSearchUrl(query: string, orientation: Orientation, perPage: number): string {
  const u = new URL(PHOTO_API);
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

export function parsePhotos(body: unknown): PexelsPhoto[] {
  const photos = (body as { photos?: unknown[] })?.photos;
  if (!Array.isArray(photos)) throw new Error("Unexpected Pexels response (no photos array)");
  return photos as PexelsPhoto[];
}

export async function searchVideos(
  query: string,
  opts: { apiKey: string; orientation?: Orientation; perPage?: number },
): Promise<PexelsVideo[]> {
  const res = await fetch(searchUrl(query, opts.orientation ?? "portrait", opts.perPage ?? 8), {
    headers: { Authorization: opts.apiKey },
  });
  if (!res.ok) throw new Error(`Pexels video search failed: ${res.status} ${res.statusText}`);
  return parseVideos(await res.json());
}

export async function searchPhotos(
  query: string,
  opts: { apiKey: string; orientation?: Orientation; perPage?: number },
): Promise<PexelsPhoto[]> {
  const res = await fetch(photoSearchUrl(query, opts.orientation ?? "portrait", opts.perPage ?? 8), {
    headers: { Authorization: opts.apiKey },
  });
  if (!res.ok) throw new Error(`Pexels photo search failed: ${res.status} ${res.statusText}`);
  return parsePhotos(await res.json());
}

// The composition renders app cut-ins at width 1080 — pick the smallest mp4 that still covers it
// (no wasted download), else the largest one available.
export function pickFile(v: PexelsVideo, targetWidth = 1080): PexelsVideoFile | null {
  const mp4s = v.video_files.filter((f) => f.file_type === "video/mp4" && f.width > 0);
  if (mp4s.length === 0) return null;
  const covering = mp4s.filter((f) => f.width >= targetWidth).sort((a, b) => a.width - b.width);
  return covering[0] ?? mp4s.sort((a, b) => b.width - a.width)[0];
}

/** Download URL for a still — the full-resolution `original`. The photo search is already
 *  filtered by orientation, so Pexels' oriented crop (`src.landscape`/`src.portrait`) adds
 *  nothing but a silent ~1200px downscale of the listed native size (looks obviously low-res
 *  once a shader magnifies it). Prefer `original`, then the largest fixed sizes, then the
 *  oriented crop as a last resort. */
export function pickPhotoUrl(p: PexelsPhoto, orientation: Orientation = "portrait"): string {
  const oriented = orientation === "landscape" ? p.src.landscape : p.src.portrait;
  return p.src.original || p.src.large2x || p.src.large || oriented || p.src.medium || p.src.small;
}

/** Tiny preview for agent screening (before downloading the full still). */
export function pickPhotoThumb(p: PexelsPhoto): string {
  return p.src.tiny || p.src.small || p.src.medium || p.src.large;
}

export async function downloadVideo(v: PexelsVideo, out: string): Promise<void> {
  const file = pickFile(v);
  if (!file) throw new Error(`Pexels video ${v.id} has no downloadable mp4`);
  await download(file.link, out);
}

export async function downloadPhoto(
  p: PexelsPhoto,
  out: string,
  orientation: Orientation = "portrait",
): Promise<void> {
  await download(pickPhotoUrl(p, orientation), out);
}
