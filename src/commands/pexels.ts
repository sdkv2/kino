// `kino pexels` — search Pexels stock videos and pull one into a project's assets/ as b-roll.
// Two-step by design: search first (list durations/sizes), then --get <n> to download, so the
// driving agent picks deliberately instead of grabbing the first hit. Downloaded clips land in
// assets/pexels/<id>.mp4 and are referenced from app segments like any other asset.
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveProject, resolveWorkspace } from "../config/project.js";
import { loadEnv, requireKey } from "../config/env.js";
import { searchVideos, pickFile } from "../media/pexels.js";
import { download } from "../media/net.js";
import { log } from "../log.js";

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
    videos.forEach((v, i) => {
      const f = pickFile(v);
      const size = f ? `${f.width}x${f.height}` : "no mp4";
      process.stdout.write(`  ${String(i + 1).padStart(2)}. #${v.id}  ${String(v.duration).padStart(3)}s  ${size.padEnd(10)} by ${v.user.name}\n`);
    });
    process.stdout.write(`\nDownload one:  kino pexels "${query}" --get <n> --project <name>\n`);
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
  log.ok(dest);
  process.stdout.write(`\nUse it in a spec's app segment:\n  { "kind": "app", "asset": "${rel}", ... }\n`);
}
