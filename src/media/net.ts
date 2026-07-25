import { writeFile, readFile } from "node:fs/promises";
import { basename } from "node:path";

/** Fetch with automatic retries for rate limits (429) and server errors (5xx), plus timeout support. */
export async function fetchWithRetry(
  input: string | URL | Request,
  init?: RequestInit,
  opts: { retries?: number; timeoutMs?: number } = {},
): Promise<Response> {
  const retries = opts.retries ?? 3;
  const timeoutMs = opts.timeoutMs ?? 30000;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let signal = controller.signal;
    if (init?.signal) {
      if (init.signal.aborted) {
        clearTimeout(timer);
        throw init.signal.reason ?? new Error("Aborted");
      }
      const userSignal = init.signal;
      const combined = new AbortController();
      userSignal.addEventListener("abort", () => combined.abort(userSignal.reason), { once: true });
      controller.signal.addEventListener("abort", () => combined.abort(new Error(`Request timed out after ${timeoutMs}ms`)), { once: true });
      signal = combined.signal;
    }

    try {
      const res = await fetch(input, { ...init, signal });
      clearTimeout(timer);
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const backoff = Math.pow(2, attempt) * 500 + Math.random() * 200;
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < retries) {
        const backoff = Math.pow(2, attempt) * 500 + Math.random() * 200;
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }
  throw lastErr;
}

/** Download a URL to a local file. */
export async function download(url: string, out: string): Promise<void> {
  const res = await fetchWithRetry(url);
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
