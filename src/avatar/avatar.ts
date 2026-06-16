import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Cache } from "../media/cache.js";
import type { Brand } from "../config/brand.js";
import { contentHash } from "../media/hash.js";
import type { Provider } from "./provider.js";
import { uploadAsset, generate, pollDownload, generateMock } from "./heygen.js";
import { hedraGenerate } from "./hedra.js";
import { replicateGenerate, type ReplicateCfg } from "./replicate.js";

export interface BuildAvatarOpts {
  provider: Exclude<Provider, "none">;
  audioPath: string; // trimmed avatar-only VO track (only the on-camera segments)
  source: string; // heygen: look id · hedra/replicate: portrait image path
  brand: Brand;
  cache: Cache;
  mock: boolean;
}

function replicateCfg(brand: Brand): ReplicateCfg {
  // Default to the official bytedance/omni-human (image+audio talking head) — it boots reliably on
  // Replicate, unlike the community SadTalker deployment which queues/cold-stalls. Override per brand.
  return {
    model: brand.replicateModel ?? "bytedance/omni-human",
    imageField: brand.replicateImageField ?? "image",
    audioField: brand.replicateAudioField ?? "audio",
    extra: brand.replicateInput ?? {},
  };
}

export async function buildAvatar({ provider, audioPath, source, brand, cache, mock }: BuildAvatarOpts): Promise<string> {
  // Cache on everything that changes the pixels: provider, look/image, trimmed-audio bytes.
  const key = contentHash({ provider, size: statSync(audioPath).size, source, mock });
  const cached = cache.get(key, "mp4");
  if (cached) return cached;

  const dir = mkdtempSync(join(tmpdir(), "kino-av-"));
  const tmp = join(dir, "avatar.mp4");
  if (mock) {
    await generateMock(tmp);
  } else if (provider === "heygen") {
    const assetId = await uploadAsset(audioPath);
    const videoId = await generate(source, assetId);
    await pollDownload(videoId, tmp);
  } else if (provider === "hedra") {
    await hedraGenerate(audioPath, source, { modelId: brand.hedraModelId }, tmp);
  } else if (provider === "replicate") {
    await replicateGenerate(audioPath, source, replicateCfg(brand), tmp);
  } else {
    throw new Error(`Unknown avatar provider: ${provider}`);
  }
  return cache.put(key, "mp4", tmp);
}
