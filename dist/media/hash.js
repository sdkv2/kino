import { createHash } from "node:crypto";
function stable(v) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
        return "{" + Object.keys(v).sort().map((k) => `${k}:${stable(v[k])}`).join(",") + "}";
    }
    return JSON.stringify(v);
}
export function contentHash(input) {
    return createHash("sha256").update(stable(input)).digest("hex").slice(0, 16);
}
