import { writeFile, readFile } from "node:fs/promises";
import { basename } from "node:path";

/** Download a URL to a local file. */
export async function download(url: string, out: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${url} → ${res.status}`);
  await writeFile(out, Buffer.from(await res.arrayBuffer()));
}

export function mimeOf(path: string): string {
  const p = path.toLowerCase();
  if (p.endsWith(".png")) return "image/png";
  if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
  if (p.endsWith(".webp")) return "image/webp";
  if (p.endsWith(".mp3")) return "audio/mpeg";
  if (p.endsWith(".wav")) return "audio/wav";
  if (p.endsWith(".mp4")) return "video/mp4";
  return "application/octet-stream";
}

/** A multipart-form file part from a local file (Node 25 global FormData/Blob). */
export async function filePart(path: string): Promise<Blob> {
  return new Blob([await readFile(path)], { type: mimeOf(path) });
}

export const fileName = basename;
