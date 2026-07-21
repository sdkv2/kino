import { execa } from "execa";
import { FFMPEG_PATH } from "../media/binPaths.js";

export interface Look {
  id: string;
  gender?: string;
  preferred_orientation?: string;
  supported_api_engines?: string[];
  name?: string;
}

export function isAvatarIV(look: { supported_api_engines?: string[] }): boolean {
  return (look.supported_api_engines ?? []).includes("avatar_iv");
}

export function pickPhotoLooks(looks: Look[]): Look[] {
  return looks.filter((l) => l.preferred_orientation === "portrait" && isAvatarIV(l));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function hey(args: string[]): Promise<any> {
  const { stdout } = await execa("heygen", args, { env: process.env });
  return JSON.parse(stdout);
}

export async function uploadAsset(file: string): Promise<string> {
  const d = await hey(["asset", "create", "--file", file]);
  return d.data.asset_id as string;
}

export async function generate(lookId: string, audioAssetId: string): Promise<string> {
  const body = JSON.stringify({
    type: "avatar",
    avatar_id: lookId,
    audio_asset_id: audioAssetId,
    aspect_ratio: "9:16",
    resolution: "1080p",
    fit: "cover",
    caption: { file_format: "srt" },
    title: "kino",
  });
  const d = await hey(["video", "create", "-d", body]);
  if (d.error) throw new Error(`HeyGen generate: ${d.error.message}`);
  return d.data.video_id as string;
}

export async function pollDownload(videoId: string, out: string, timeoutSec = 600): Promise<void> {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    const d = await hey(["video", "get", videoId]);
    const st = d.data?.status;
    if (st === "completed") {
      await execa("heygen", ["video", "download", videoId, "--output-path", out]);
      return;
    }
    if (st === "failed") throw new Error(`HeyGen video failed: ${JSON.stringify(d.data?.error)}`);
    await new Promise((r) => setTimeout(r, 12000));
  }
  throw new Error("HeyGen timed out");
}

// --mock: a 6s silent placeholder so render runs with zero spend.
export async function generateMock(out: string): Promise<void> {
  await execa(FFMPEG_PATH, [
    "-y", "-loglevel", "error",
    "-f", "lavfi", "-i", "color=c=0x0b1020:s=1080x1920:r=30:d=6",
    "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
    "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", out,
  ]);
}
