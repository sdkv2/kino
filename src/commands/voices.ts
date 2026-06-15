import { resolveProject } from "../config/project.js";
import { loadEnv, requireKey } from "../config/env.js";
import { listVoices } from "../vo/elevenlabs.js";

export async function voices(opts: { gender?: string }): Promise<void> {
  loadEnv(resolveProject().root);
  const vs = await listVoices(requireKey("ELEVENLABS_API_KEY"));
  for (const v of vs) {
    if (!opts.gender || v.gender === opts.gender) {
      console.log(`${v.id}  ${v.name}  ${v.gender ?? ""} ${v.age ?? ""} ${v.accent ?? ""}`);
    }
  }
}
