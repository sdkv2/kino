// Open-source lip-sync via Replicate. Verified shape:
//   POST /v1/files (multipart "content")              → upload image/audio, returns {urls:{get}}
//   POST /v1/models/{owner}/{name}/predictions {input} (latest version)  — or
//   POST /v1/predictions {version,input}              (when a :version pin is given)
//   GET  urls.get                                      → poll {status, output, error}
// The default model (set in avatar.ts → replicateCfg) is bytedance/omni-human, an image+audio
// talking-head that boots reliably on Replicate. Field names are overridable per brand because
// each lip-sync model names its inputs differently.
import { download, filePart, fileName } from "../media/net.js";

const API = "https://api.replicate.com/v1";

function auth(): Record<string, string> {
  const t = process.env.REPLICATE_API_TOKEN;
  if (!t) throw new Error("Missing REPLICATE_API_TOKEN. Add it to .env (replicate.com/account/api-tokens).");
  return { authorization: `Bearer ${t}` };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rj(path: string, init: RequestInit & { json?: unknown } = {}): Promise<any> {
  const { json, headers, ...rest } = init;
  const url = path.startsWith("http") ? path : `${API}${path}`;
  const res = await fetch(url, {
    ...rest,
    headers: {
      ...auth(),
      ...(json !== undefined ? { "content-type": "application/json" } : {}),
      ...(headers as Record<string, string> | undefined),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (!res.ok) throw new Error(`Replicate ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function uploadFile(file: string): Promise<string> {
  const fd = new FormData();
  fd.append("content", await filePart(file), fileName(file));
  const res = await fetch(`${API}/files`, { method: "POST", headers: auth(), body: fd });
  if (!res.ok) throw new Error(`Replicate files → ${res.status}: ${await res.text()}`);
  const d = await res.json();
  return d.urls.get as string;
}

export interface ReplicateCfg {
  model: string; // owner/name or owner/name:version
  imageField: string;
  audioField: string;
  extra: Record<string, unknown>;
}

export async function replicateGenerate(audioPath: string, imagePath: string, cfg: ReplicateCfg, out: string): Promise<void> {
  const imageUrl = await uploadFile(imagePath);
  const audioUrl = await uploadFile(audioPath);
  const input = { [cfg.imageField]: imageUrl, [cfg.audioField]: audioUrl, ...cfg.extra };
  // Resolve a version hash: pinned (owner/name:version) or the model's latest. The /v1/predictions
  // {version} route works for community models; /models/.../predictions is official-models only (404s).
  let version: string;
  if (cfg.model.includes(":")) {
    version = cfg.model.split(":")[1];
  } else {
    const m = await rj(`/models/${cfg.model}`, { method: "GET" });
    version = m.latest_version?.id;
    if (!version) throw new Error(`Replicate model ${cfg.model} has no runnable version`);
  }
  const pred = await rj("/predictions", { method: "POST", json: { version, input } });
  await download(await pollReplicate(pred), out);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function pollReplicate(pred: any, timeoutSec = 900): Promise<string> {
  let cur = pred;
  const getUrl = cur.urls?.get as string;
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    if (cur.status === "succeeded") return pickOutput(cur.output);
    if (cur.status === "failed" || cur.status === "canceled") {
      throw new Error(`Replicate ${cur.status}: ${cur.error ?? "unknown"}`);
    }
    await new Promise((r) => setTimeout(r, 5000));
    cur = await rj(getUrl, { method: "GET" });
  }
  throw new Error("Replicate timed out");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pickOutput(out: any): string {
  if (typeof out === "string") return out;
  if (Array.isArray(out) && out.length) return out[out.length - 1];
  if (out && typeof out.video === "string") return out.video;
  throw new Error(`Replicate output is not a video url: ${JSON.stringify(out)}`);
}
