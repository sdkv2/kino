// voices: list/inspect the available ElevenLabs voices (id, name, gender/age/accent) so an agent can
// pick a voice id for a spec; --gender filters the list. Read-only — prints to stdout, no API spend
// beyond the voices lookup.
import { resolveWorkspace } from "../config/project.js";
import { loadEnv, requireKey } from "../config/env.js";
import { listVoices } from "../vo/elevenlabs.js";
import { emitJson, wantsJson } from "./emit.js";

export async function voices(opts: { gender?: string; as?: string }): Promise<void> {
  loadEnv(resolveWorkspace().workspaceRoot);
  const vs = await listVoices(requireKey("ELEVENLABS_API_KEY"));
  const picked = vs.filter((v) => !opts.gender || v.gender === opts.gender);
  if (wantsJson(opts)) return emitJson({ kind: "voices", voices: picked });
  for (const v of picked) console.log(`${v.id}  ${v.name}  ${v.gender ?? ""} ${v.age ?? ""} ${v.accent ?? ""}`);
}
