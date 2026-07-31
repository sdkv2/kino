import { execa } from "execa";
import { pickPhotoLooks, type Look } from "../avatar/heygen.js";
import { emitJson, wantsJson } from "./emit.js";

// Lists the Avatar-IV-capable portrait photo-avatar looks (the ones the CLI can drive).
export async function avatars(opts: { gender?: string; as?: string }): Promise<void> {
  const { stdout } = await execa("heygen", [
    "avatar", "looks", "list", "--ownership", "public", "--avatar-type", "photo_avatar", "--limit", "50",
  ]);
  const looks = (JSON.parse(stdout).data ?? []) as Look[];
  const picked = pickPhotoLooks(looks).filter((l) => !opts.gender || l.gender === opts.gender);
  if (wantsJson(opts)) return emitJson({ kind: "avatars", avatars: picked });
  for (const l of picked) console.log(`${l.id}  ${l.name ?? ""}  ${l.gender ?? ""}`);
}
