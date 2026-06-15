import { existsSync } from "node:fs";
export function complianceScan(spec, brand) {
    const hits = [];
    spec.segments.forEach((seg, i) => {
        for (const field of ["text", "caption"]) {
            const val = seg[field];
            if (typeof val !== "string")
                continue;
            for (const p of brand.bannedPhrases) {
                if (val.toLowerCase().includes(p.toLowerCase()))
                    hits.push({ phrase: p, where: `segment[${i}].${field}` });
            }
        }
    });
    return hits;
}
export function resolveVoiceLook(spec, brand) {
    const voiceAlias = spec.voice ?? brand.defaultVoice;
    const lookAlias = spec.avatarLook ?? brand.defaultLook;
    if (!voiceAlias)
        throw new Error("No voice: set spec.voice or brand.defaultVoice");
    if (!lookAlias)
        throw new Error("No avatar look: set spec.avatarLook or brand.defaultLook");
    const voiceId = brand.voiceAliases[voiceAlias] ?? voiceAlias;
    const lookId = brand.lookAliases[lookAlias] ?? lookAlias;
    return { voiceId, lookId };
}
export function assertAssetsExist(spec, project) {
    for (const [i, seg] of spec.segments.entries()) {
        if (seg.kind === "app" && !existsSync(project.assetPath(seg.asset))) {
            throw new Error(`Missing asset for segment[${i}]: assets/${seg.asset}`);
        }
    }
}
export function validateSpec(spec, brand, project) {
    const hits = complianceScan(spec, brand);
    if (hits.length) {
        throw new Error("Compliance: banned phrases found — " + hits.map((h) => `"${h.phrase}" @ ${h.where}`).join("; "));
    }
    resolveVoiceLook(spec, brand);
    assertAssetsExist(spec, project);
}
