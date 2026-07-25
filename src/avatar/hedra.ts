// Hedra Character-3 talking-avatar API. Verified shape (api.hedra.com/web-app/public):
//   GET  /models                     → pick the Character-3 model id
//   POST /assets {name,type}         → create image / audio asset, returns {id}
//   POST /assets/{id}/upload (multipart file)
//   POST /generations {type,ai_model_id,start_keyframe_id,audio_id,generated_video_inputs}
//   GET  /generations/{id}/status    → {status: queued|processing|complete|error, url}
import { download, filePart, fileName } from "../media/net.js";

const BASE = process.env.HEDRA_BASE_URL || "https://api.hedra.com/web-app/public";

function apiKey(): string {
  const k = process.env.HEDRA_API_KEY;
  if (!k) throw new Error("Missing HEDRA_API_KEY. Add it to .env (get one at hedra.com/api-profile).");
  return k;
}

interface HedraAssetResponse {
  id: string;
}

interface HedraModelResponse {
  id: string;
}

interface HedraStatusResponse {
  status: "queued" | "processing" | "complete" | "error";
  url?: string;
  error_message?: string;
}

// Authenticated JSON fetch against the Hedra API (throws on non-2xx).
async function hedraFetch<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    headers: {
      "x-api-key": apiKey(),
      ...(json !== undefined ? { "content-type": "application/json" } : {}),
      ...(headers as Record<string, string> | undefined),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (!res.ok) throw new Error(`Hedra ${path} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function createAndUpload(file: string, type: "image" | "audio"): Promise<string> {
  const asset = await hedraFetch<HedraAssetResponse>("/assets", { method: "POST", json: { name: fileName(file), type } });
  const fd = new FormData();
  fd.append("file", await filePart(file), fileName(file));
  const res = await fetch(`${BASE}/assets/${asset.id}/upload`, {
    method: "POST",
    headers: { "x-api-key": apiKey() },
    body: fd,
  });
  if (!res.ok) throw new Error(`Hedra upload ${type} → ${res.status}: ${await res.text()}`);
  return asset.id;
}

async function pickModelId(): Promise<string> {
  const models = await hedraFetch<HedraModelResponse[] | { data: HedraModelResponse[] }>("/models", { method: "GET" });
  const list = Array.isArray(models) ? models : (models.data ?? []);
  if (!list.length) throw new Error("Hedra: no models on this account");
  return list[0].id;
}

export interface HedraOpts {
  modelId?: string;
  resolution?: "540p" | "720p";
  prompt?: string;
}

export async function hedraGenerate(audioPath: string, imagePath: string, opts: HedraOpts, out: string): Promise<void> {
  const modelId = opts.modelId ?? (await pickModelId());
  const imageId = await createAndUpload(imagePath, "image");
  const audioId = await createAndUpload(audioPath, "audio");
  const gen = await hedraFetch<{ id: string }>("/generations", {
    method: "POST",
    json: {
      type: "video",
      ai_model_id: modelId,
      start_keyframe_id: imageId,
      audio_id: audioId,
      generated_video_inputs: {
        text_prompt: opts.prompt || "A person speaking to camera, natural expression",
        resolution: opts.resolution ?? "720p",
        aspect_ratio: "9:16",
      },
    },
  });
  const url = await pollHedra(gen.id);
  await download(url, out);
}

async function pollHedra(genId: string, timeoutSec = 900): Promise<string> {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    const d = await hedraFetch<HedraStatusResponse>(`/generations/${genId}/status`, { method: "GET" });
    if (d.status === "complete") {
      if (!d.url) throw new Error("Hedra reported complete but returned no url");
      return d.url;
    }
    if (d.status === "error") throw new Error(`Hedra generation failed: ${d.error_message ?? "unknown"}`);
    await new Promise((r) => setTimeout(r, 8000));
  }
  throw new Error("Hedra timed out");
}
