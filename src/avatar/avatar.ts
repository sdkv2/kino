import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Cache } from "../media/cache.js";
import { contentHash } from "../media/hash.js";
import { uploadAsset, generate, pollDownload, generateMock } from "./heygen.js";

export interface BuildAvatarOpts {
  voPath: string;
  lookId: string;
  cache: Cache;
  mock: boolean;
}

export async function buildAvatar({ voPath, lookId, cache, mock }: BuildAvatarOpts): Promise<string> {
  const voHash = contentHash({ size: statSync(voPath).size, lookId, mock });
  const cached = cache.get(voHash, "mp4");
  if (cached) return cached;
  const dir = mkdtempSync(join(tmpdir(), "kino-av-"));
  const tmp = join(dir, "avatar.mp4");
  if (mock) {
    await generateMock(tmp);
  } else {
    const assetId = await uploadAsset(voPath);
    const videoId = await generate(lookId, assetId);
    await pollDownload(videoId, tmp);
  }
  return cache.put(voHash, "mp4", tmp);
}
