// Freesound search + preview download (freesound.org/apiv2 — free key).
// Defaults target short-form beds: CC0 only, 15–90s, so a 15–30s TikTok/Reels cut can loop
// or trim without a 5-minute epic. HQ originals need OAuth; mp3 previews need only the API token.
import { download } from "./net.js";

export interface FreesoundHit {
  id: number;
  name: string;
  duration: number;
  license: string;
  username: string;
  tags: string[];
  previews: {
    "preview-hq-mp3"?: string;
    "preview-lq-mp3"?: string;
  };
}

export interface SearchOpts {
  apiKey: string;
  pageSize?: number;
  /** Inclusive duration filter in seconds (short-form default: 15–90). */
  minSec?: number;
  maxSec?: number;
}

const API = "https://freesound.org/apiv2/search/text/";

export function searchUrl(query: string, opts: Omit<SearchOpts, "apiKey"> = {}): string {
  const minSec = opts.minSec ?? 15;
  const maxSec = opts.maxSec ?? 90;
  const pageSize = opts.pageSize ?? 8;
  const u = new URL(API);
  u.searchParams.set("query", query);
  // CC0 only — safe to use in ads without attribution; filter before download.
  u.searchParams.set("filter", `license:"Creative Commons 0" duration:[${minSec} TO ${maxSec}]`);
  u.searchParams.set("fields", "id,name,duration,license,username,tags,previews");
  u.searchParams.set("page_size", String(pageSize));
  u.searchParams.set("sort", "rating_desc");
  return u.toString();
}

export function parseHits(body: unknown): FreesoundHit[] {
  const results = (body as { results?: unknown[] })?.results;
  if (!Array.isArray(results)) throw new Error("Unexpected Freesound response (no results array)");
  return results as FreesoundHit[];
}

export async function searchSounds(query: string, opts: SearchOpts): Promise<FreesoundHit[]> {
  const url = searchUrl(query, opts);
  const res = await fetch(url, {
    headers: { Authorization: `Token ${opts.apiKey}` },
  });
  if (!res.ok) throw new Error(`Freesound search failed: ${res.status} ${res.statusText}`);
  return parseHits(await res.json());
}

export function previewUrl(hit: FreesoundHit): string | null {
  return hit.previews?.["preview-hq-mp3"] ?? hit.previews?.["preview-lq-mp3"] ?? null;
}

export async function downloadPreview(hit: FreesoundHit, out: string): Promise<void> {
  const url = previewUrl(hit);
  if (!url) throw new Error(`Freesound #${hit.id} has no mp3 preview`);
  await download(url, out);
}

/** Short-form query hints agents can paste into `kino music "<q>"`. */
export const SHORTFORM_QUERIES = [
  { q: "soft ambient pad loop", use: "VO bed — sleep / wellness / calm" },
  { q: "gentle piano background", use: "editorial / reflection" },
  { q: "upbeat corporate soft", use: "SaaS / product CTA energy (keep ducked)" },
  { q: "lofi chill beat loop", use: "lifestyle / casual consumer" },
  { q: "dark atmospheric drone", use: "tension hook, then duck under VO" },
] as const;
