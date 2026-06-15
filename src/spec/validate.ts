import { existsSync } from "node:fs";
import type { Brand } from "../config/brand.js";
import type { Spec } from "./schema.js";
import type { Project } from "../config/project.js";

export interface ComplianceHit { phrase: string; where: string; }

export function complianceScan(spec: Spec, brand: Brand): ComplianceHit[] {
  const hits: ComplianceHit[] = [];
  spec.segments.forEach((seg, i) => {
    for (const field of ["text", "caption"] as const) {
      const val = (seg as Record<string, unknown>)[field];
      if (typeof val !== "string") continue;
      for (const p of brand.bannedPhrases) {
        if (val.toLowerCase().includes(p.toLowerCase())) hits.push({ phrase: p, where: `segment[${i}].${field}` });
      }
    }
  });
  return hits;
}

export function resolveVoiceLook(spec: Spec, brand: Brand): { voiceId: string; lookId: string } {
  const voiceAlias = spec.voice ?? brand.defaultVoice;
  const lookAlias = spec.avatarLook ?? brand.defaultLook;
  if (!voiceAlias) throw new Error("No voice: set spec.voice or brand.defaultVoice");
  if (!lookAlias) throw new Error("No avatar look: set spec.avatarLook or brand.defaultLook");
  const voiceId = brand.voiceAliases[voiceAlias] ?? voiceAlias;
  const lookId = brand.lookAliases[lookAlias] ?? lookAlias;
  return { voiceId, lookId };
}

export function assertAssetsExist(spec: Spec, project: Project): void {
  for (const [i, seg] of spec.segments.entries()) {
    if (seg.kind === "app" && !existsSync(project.assetPath(seg.asset))) {
      throw new Error(`Missing asset for segment[${i}]: assets/${seg.asset}`);
    }
  }
}

export function validateSpec(spec: Spec, brand: Brand, project: Project): void {
  const hits = complianceScan(spec, brand);
  if (hits.length) {
    throw new Error("Compliance: banned phrases found — " + hits.map((h) => `"${h.phrase}" @ ${h.where}`).join("; "));
  }
  resolveVoiceLook(spec, brand);
  assertAssetsExist(spec, project);
}
