// `kino pexels` — search Pexels stock videos and pull one into a project's assets/ as b-roll.
// Two-step by design: search first (list durations/sizes + cached local thumbs), then --get <n>
// to download, so the driving agent picks deliberately instead of grabbing the first hit.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { resolveProject, resolveWorkspace } from "../config/project.js";
import { loadEnv, requireKey } from "../config/env.js";
import { searchVideos, pickFile } from "../media/pexels.js";
import { download } from "../media/net.js";
import { log } from "../log.js";

const THUMB_DIR = join(tmpdir(), "kino-pexels-thumbs");

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
    return url; // fall back to remote URL if the cache write fails
  }
}

function noteAttribution(projectRoot: string, entry: string): void {
  const path = join(projectRoot, "ATTRIBUTION.md");
  let body = "";
  try {
    body = readFileSync(path, "utf8");
  } catch {
    body =
      "# Stock attribution\n\nClips downloaded via `kino pexels` (Pexels License — free to use).\n\n";
    writeFileSync(path, body);
  }
  if (body.includes(entry)) return;
  appendFileSync(path, `- ${entry}\n`);
}

export async function pexels(
  query: string,
  opts: { get?: string; count?: string; landscape?: boolean; out?: string; project?: string },
): Promise<void> {
  loadEnv(resolveWorkspace().workspaceRoot);
  const apiKey = requireKey("PEXELS_API_KEY");
  const orientation = opts.landscape ? "landscape" : "portrait";
  const perPage = opts.count ? Number(opts.count) : 8;
  const videos = await searchVideos(query, { apiKey, orientation, perPage });
  if (videos.length === 0) {
    log.warn(`No Pexels videos for "${query}" (${orientation}) — try broader keywords.`);
    return;
  }

  if (opts.get === undefined) {
    process.stdout.write(`Pexels videos for "${query}" (${orientation}):\n\n`);
    const thumbs = await Promise.all(videos.map((v) => cacheThumb(v.id, v.image)));
    videos.forEach((v, i) => {
      const f = pickFile(v);
      const size = f ? `${f.width}x${f.height}` : "no mp4";
      process.stdout.write(
        `  ${String(i + 1).padStart(2)}. #${v.id}  ${String(v.duration).padStart(3)}s  ${size.padEnd(10)} by ${v.user.name}\n` +
          `      thumb: ${thumbs[i]}\n`,
      );
    });
    process.stdout.write(
      `\nScreen a local thumb above (Read tool) before downloading — cheaper than pulling the mp4.\n`,
    );
    process.stdout.write(`Download one:  kino pexels "${query}" --get <n> --project <name>\n`);
    process.stdout.write("Videos provided by Pexels (pexels.com) — free to use.\n");
    return;
  }

  const n = Number(opts.get);
  if (!Number.isInteger(n) || n < 1 || n > videos.length) {
    throw new Error(`--get must be 1..${videos.length} (from the search results)`);
  }
  const v = videos[n - 1];
  const file = pickFile(v);
  if (!file) throw new Error(`Pexels video #${v.id} has no downloadable mp4`);
  const project = resolveProject({ project: opts.project });
  const rel = opts.out ?? join("pexels", `${v.id}.mp4`);
  const dest = project.assetPath(rel);
  mkdirSync(dirname(dest), { recursive: true });
  log.step(`downloading #${v.id} (${file.width}x${file.height}, ${v.duration}s, by ${v.user.name})`);
  await download(file.link, dest);
  noteAttribution(project.projectRoot, `Pexels #${v.id} — ${v.user.name} — assets/${rel}`);
  log.ok(dest);
  process.stdout.write(`\nUse it in a spec's app segment:\n  { "kind": "app", "asset": "${rel}", ... }\n`);
}
