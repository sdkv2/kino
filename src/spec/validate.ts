import { existsSync, readFileSync } from "node:fs";
import type { Brand } from "../config/brand.js";
import type { Spec } from "./schema.js";
import type { Project } from "../config/project.js";
import type { Provider } from "../avatar/provider.js";
import { lintMotionHtml } from "../render/motiongraphic.js";

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

export function resolveProvider(spec: Spec, brand: Brand): Provider {
  return (spec.provider ?? brand.defaultProvider ?? "heygen") as Provider;
}

export function resolveVoice(spec: Spec, brand: Brand): string {
  const alias = spec.voice ?? brand.defaultVoice;
  if (!alias) throw new Error("No voice: set spec.voice or brand.defaultVoice");
  return brand.voiceAliases[alias] ?? alias;
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

// Motion graphics: every referenced HTML file must exist and pass the determinism/safety lint.
// Runs before VO generation so a bad graphic fails the build cheaply.
export function assertMotionGraphics(spec: Spec, project: { assetPath(rel: string): string }): void {
  const refs: { source: string; where: string }[] = [];
  spec.segments.forEach((seg, i) => {
    if (seg.kind === "motion") refs.push({ source: seg.source, where: `segment[${i}]` });
    const ov = (seg as { motionOverlay?: { source?: string } }).motionOverlay;
    if (ov?.source) refs.push({ source: ov.source, where: `segment[${i}].motionOverlay` });
  });
  for (const { source, where } of refs) {
    const abs = project.assetPath(source);
    if (!existsSync(abs)) throw new Error(`Missing motion graphic for ${where}: assets/${source}`);
    const violations = lintMotionHtml(readFileSync(abs, "utf8"));
    if (violations.length) throw new Error(`Motion graphic ${where} (assets/${source}): ${violations.join("; ")}`);
  }
}

export function validateSpec(spec: Spec, brand: Brand, project: Project): void {
  const hits = complianceScan(spec, brand);
  if (hits.length) {
    throw new Error("Compliance: banned phrases found — " + hits.map((h) => `"${h.phrase}" @ ${h.where}`).join("; "));
  }
  resolveVoiceLook(spec, brand);
  assertAssetsExist(spec, project);
  assertMotionGraphics(spec, project);
}
