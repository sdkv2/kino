import { execa } from "execa";
import { pickPhotoLooks } from "../avatar/heygen.js";
// Lists the Avatar-IV-capable portrait photo-avatar looks (the ones the CLI can drive).
export async function avatars(opts) {
    const { stdout } = await execa("heygen", [
        "avatar", "looks", "list", "--ownership", "public", "--avatar-type", "photo_avatar", "--limit", "50",
    ]);
    const looks = (JSON.parse(stdout).data ?? []);
    for (const l of pickPhotoLooks(looks)) {
        if (!opts.gender || l.gender === opts.gender)
            console.log(`${l.id}  ${l.name ?? ""}  ${l.gender ?? ""}`);
    }
}
