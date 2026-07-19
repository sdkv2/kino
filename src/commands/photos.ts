// `kino photos` — search Pexels stock photos and pull one into a project's assets/ as a still.
// Same two-step as `kino pexels` (video): list + local thumbs, then --get <n> to download.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { resolveProject, resolveWorkspace } from "../config/project.js";
import { loadEnv, requireKey } from "../config/env.js";
import { pickPhotoThumb, pickPhotoUrl, searchPhotos } from "../media/pexels.js";
import { download } from "../media/net.js";
import { log } from "../log.js";

const THUMB_DIR = join(tmpdir(), "kino-pexels-photo-thumbs");

async function cacheThumb(id: number, url: string): Promise<string> {
  mkdirSync(THUMB_DIR, { recursive: true });
  const dest = join(THUMB_DIR, `${id}.jpg`);
  if (existsSync(dest)) return dest;
  try {
    const res = await fetch(url);
    if (!res.ok) return url;
    writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    return dest;
  } catch {
    return url;
  }
}

function noteAttribution(projectRoot: string, entry: string): void {
  const path = join(projectRoot, "ATTRIBUTION.md");
  let body = "";
  try {
    body = readFileSync(path, "utf8");
  } catch {
    body =
      "# Stock attribution\n\nAssets downloaded via `kino pexels` / `kino photos` (Pexels License — free to use).\n\n";
    writeFileSync(path, body);
  }
  if (body.includes(entry)) return;
  appendFileSync(path, `- ${entry}\n`);
}

export async function photos(
  query: string,
  opts: { get?: string; count?: string; landscape?: boolean; out?: string; project?: string },
): Promise<void> {
  loadEnv(resolveWorkspace().workspaceRoot);
  const apiKey = requireKey("PEXELS_API_KEY");
  const orientation = opts.landscape ? "landscape" : "portrait";
  const perPage = opts.count ? Number(opts.count) : 8;
  const results = await searchPhotos(query, { apiKey, orientation, perPage });
  if (results.length === 0) {
    log.warn(`No Pexels photos for "${query}" (${orientation}) — try broader keywords.`);
    return;
  }

  if (opts.get === undefined) {
    process.stdout.write(`Pexels photos for "${query}" (${orientation}):\n\n`);
    const thumbs = await Promise.all(results.map((p) => cacheThumb(p.id, pickPhotoThumb(p))));
    results.forEach((p, i) => {
      const size = `${p.width}x${p.height}`;
      const alt = (p.alt || "").trim();
      process.stdout.write(
        `  ${String(i + 1).padStart(2)}. #${p.id}  ${size.padEnd(12)} by ${p.photographer}` +
          (alt ? `\n      ${alt.slice(0, 80)}` : "") +
          `\n      thumb: ${thumbs[i]}\n`,
      );
    });
    process.stdout.write(
      `\nScreen a local thumb above (Read tool) before downloading — cheaper than pulling the full still.\n`,
    );
    process.stdout.write(`Download one:  kino photos "${query}" --get <n> --project <name>\n`);
    process.stdout.write("Photos provided by Pexels (pexels.com) — free to use.\n");
    return;
  }

  const n = Number(opts.get);
  if (!Number.isInteger(n) || n < 1 || n > results.length) {
    throw new Error(`--get must be 1..${results.length} (from the search results)`);
  }
  const p = results[n - 1];
  const url = pickPhotoUrl(p, orientation);
  const project = resolveProject({ project: opts.project });
  const rel = opts.out ?? join("pexels", `${p.id}.jpg`);
  const dest = project.assetPath(rel);
  mkdirSync(dirname(dest), { recursive: true });
  log.step(`downloading #${p.id} (${p.width}x${p.height}, by ${p.photographer})`);
  await download(url, dest);
  noteAttribution(project.projectRoot, `Pexels photo #${p.id} — ${p.photographer} — assets/${rel}`);
  log.ok(dest);
  process.stdout.write(`\nUse it in a spec's app segment:\n  { "kind": "app", "asset": "${rel}", ... }\n`);
}
