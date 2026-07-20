// `kino music` — library beds (assets-lib/music/, ships empty) OR Freesound CC0 search.
// No arg → list library beds. Known library id → show/copy. Anything else → Freesound search
// (like kino pexels). Prefer sparse beds under VO; trending TikTok sounds are not available via API.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { catalogBeds, copyMusicBed } from "../media/music.js";
import { listMusicIds } from "../media/sfx.js";
import { downloadPreview, previewUrl, searchSounds, SHORTFORM_QUERIES } from "../media/freesound.js";
import { resolveProject, resolveWorkspace } from "../config/project.js";
import { loadEnv, requireKey } from "../config/env.js";
import { log } from "../log.js";

function noteAttribution(projectRoot: string, entry: string): void {
  const path = join(projectRoot, "ATTRIBUTION.md");
  let body = "";
  try {
    body = readFileSync(path, "utf8");
  } catch {
    body = "# Stock attribution\n\n";
    writeFileSync(path, body);
  }
  if (body.includes(entry)) return;
  appendFileSync(path, `- ${entry}\n`);
}

function printBundledHelp(): void {
  const beds = catalogBeds();
  const onDisk = listMusicIds();
  if (onDisk.length) {
    process.stdout.write("Library music beds (assets-lib/music/ — bare id in the spec):\n\n");
    for (const id of onDisk) {
      const meta = beds.find((b) => b.id === id);
      process.stdout.write(`  ${id.padEnd(16)}${meta ? ` ${meta.mood.padEnd(22)} — ${meta.use}` : ""}\n`);
    }
    process.stdout.write(`Copy into a project:  kino music <id> --get --project <name>\n`);
  } else {
    process.stdout.write(
      "No library beds (assets-lib/music/ ships empty) — drop a CC0 .mp3 there to use its bare id,\n" +
        "use a project asset path, or search Freesound below.\n",
    );
  }
  process.stdout.write(`\nIn a spec:\n  "music": { "src": "music/bed.mp3", "volume": 0.12, "duck": 0.04, "fadeOutSec": 2 }\n`);
  process.stdout.write(`\nFreesound CC0 search (15–90s beds, short-form):\n`);
  process.stdout.write(`  kino music "soft ambient pad loop"\n`);
  process.stdout.write(`  kino music "soft ambient pad loop" --get 2 --project <name>\n`);
  process.stdout.write(`\nShort-form query ideas:\n`);
  for (const s of SHORTFORM_QUERIES) {
    process.stdout.write(`  "${s.q}"  — ${s.use}\n`);
  }
  process.stdout.write(`\nTips: keep bed quiet under VO (volume ~0.10–0.14); silent cuts + duck > busy music/SFX;\n`);
  process.stdout.write(`TikTok/Reels trending audio is not pullable via API (copyright).\n`);
}

export async function music(
  idOrQuery: string | undefined,
  opts: { get?: string | boolean; project?: string; count?: string },
): Promise<void> {
  loadEnv(resolveWorkspace().workspaceRoot);
  const onDisk = listMusicIds();
  const beds = catalogBeds();
  const getRaw = opts.get;
  const getNum = typeof getRaw === "string" && getRaw !== "" ? Number(getRaw) : undefined;
  const getBundled = getRaw === true || getRaw === "";

  if (!idOrQuery) {
    printBundledHelp();
    return;
  }

  // Exact bundled id always hits the library (never Freesound), even if --get 1 is passed by habit.
  const bundled =
    beds.find((b) => b.id === idOrQuery) ??
    (onDisk.includes(idOrQuery) ? { id: idOrQuery, mood: "(on disk)", use: "library bed" } : null);

  if (bundled) {
    const wantsCopy = getBundled || getNum !== undefined;
    if (!wantsCopy) {
      process.stdout.write(`${bundled.id}\n  mood: ${bundled.mood}\n  use:  ${bundled.use}\n`);
      process.stdout.write(`\nSpec:\n  "music": { "src": "${bundled.id}", "volume": 0.12, "duck": 0.04, "fadeOutSec": 2 }\n`);
      process.stdout.write(`Copy: kino music ${bundled.id} --get --project <name>\n`);
      return;
    }
    if (!opts.project) throw new Error("--get requires --project <name>");
    const project = resolveProject({ project: opts.project });
    const rel = copyMusicBed(bundled.id, (r) => project.assetPath(r));
    log.ok(project.assetPath(rel));
    process.stdout.write(`\nUse in the spec:\n  "music": { "src": "${rel}" }\n  # or bare id: "src": "${bundled.id}"\n`);
    return;
  }

  // Freesound search / download
  const apiKey = requireKey("FREESOUND_API_KEY");
  const pageSize = opts.count ? Number(opts.count) : 8;
  const hits = await searchSounds(idOrQuery, { apiKey, pageSize });
  if (hits.length === 0) {
    log.warn(`No CC0 Freesound hits for "${idOrQuery}" (15–90s) — try a SHORTFORM query from kino music.`);
    return;
  }

  if (getNum === undefined) {
    process.stdout.write(`Freesound CC0 beds for "${idOrQuery}" (15–90s, short-form):\n\n`);
    hits.forEach((h, i) => {
      const tags = (h.tags ?? []).slice(0, 4).join(", ");
      process.stdout.write(
        `  ${String(i + 1).padStart(2)}. #${h.id}  ${h.duration.toFixed(0).padStart(3)}s  by ${h.username}\n` +
          `      ${h.name}${tags ? `  [${tags}]` : ""}\n`,
      );
    });
    process.stdout.write(`\nPreview in browser if unsure, then:\n`);
    process.stdout.write(`  kino music "${idOrQuery}" --get <n> --project <name>\n`);
    process.stdout.write(`Spec tip: volume 0.10–0.14, duck ~0.04 — VO wins on TikTok/Reels/Shorts.\n`);
    process.stdout.write(`Sounds from Freesound (CC0) — https://freesound.org/\n`);
    return;
  }

  if (!Number.isInteger(getNum) || getNum < 1 || getNum > hits.length) {
    throw new Error(`--get must be 1..${hits.length} (from the search results)`);
  }
  if (!opts.project) throw new Error("--get <n> requires --project <name>");
  const hit = hits[getNum - 1];
  if (!previewUrl(hit)) throw new Error(`Freesound #${hit.id} has no mp3 preview`);

  const project = resolveProject({ project: opts.project });
  const rel = join("music", `freesound-${hit.id}.mp3`);
  const dest = project.assetPath(rel);
  mkdirSync(dirname(dest), { recursive: true });
  if (!existsSync(dest)) {
    log.step(`downloading #${hit.id} (${hit.duration.toFixed(0)}s, by ${hit.username})`);
    await downloadPreview(hit, dest);
  } else {
    log.info(`already have ${rel}`);
  }
  noteAttribution(
    project.projectRoot,
    `Freesound #${hit.id} "${hit.name}" — ${hit.username} — CC0 — assets/${rel} — https://freesound.org/s/${hit.id}/`,
  );
  log.ok(dest);
  process.stdout.write(
    `\nUse in the spec:\n` +
      `  "music": { "src": "${rel}", "volume": 0.12, "duck": 0.04, "fadeOutSec": 2 }\n`,
  );
}
