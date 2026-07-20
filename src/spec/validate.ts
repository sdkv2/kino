import { existsSync, readFileSync } from "node:fs";
import type { Brand } from "../config/brand.js";
import type { Spec } from "./schema.js";
import type { Project } from "../config/project.js";
import type { Provider } from "../avatar/provider.js";
import { lintMotionSource } from "../render/motiongraphic.js";
import { resolveAudioSource } from "../media/sfx.js";

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

// The resolver trio below collapses spec + brand defaults into the concrete values the pipeline
// needs, applying the brand-alias passthrough (an alias resolves via brand.voiceAliases /
// lookAliases; an unknown alias is passed through verbatim as a raw id). Note the deliberate
// asymmetry around "missing" values: resolveVoice returns '' as a "no voice configured" sentinel
// because a faceless build is valid, whereas resolveVoiceLook throws — an avatar build with no
// voice or look is unrecoverable, so it fails loud rather than producing a silent empty render.

/** spec.provider, else brand.defaultProvider, else "none" (faceless). */
export function resolveProvider(spec: Spec, brand: Brand): Provider {
  return (spec.provider ?? brand.defaultProvider ?? "none") as Provider;
}

/**
 * Resolve the voice id: spec.voice, else brand.defaultVoice, mapped through brand.voiceAliases
 * (unknown alias passes through as a raw id). Returns '' when nothing is configured — a valid
 * "no voice" state for faceless builds, not an error.
 */
export function resolveVoice(spec: Spec, brand: Brand): string {
  const alias = spec.voice ?? brand.defaultVoice;
  return alias ? (brand.voiceAliases[alias] ?? alias) : "";
}

/**
 * Resolve both voice and avatar-look ids for an avatar build (spec value, else brand default, each
 * mapped through its alias map with raw-id passthrough). Throws when either is missing: an avatar
 * render with no voice or no look is unrecoverable, so this fails loud rather than returning a
 * sentinel.
 */
export function resolveVoiceLook(spec: Spec, brand: Brand): { voiceId: string; lookId: string } {
  const voiceAlias = spec.voice ?? brand.defaultVoice;
  const lookAlias = spec.avatarLook ?? brand.defaultLook;
  if (!voiceAlias) throw new Error("No voice: set spec.voice or brand.defaultVoice");
  if (!lookAlias) throw new Error("No avatar look: set spec.avatarLook or brand.defaultLook");
  const voiceId = brand.voiceAliases[voiceAlias] ?? voiceAlias;
  const lookId = brand.lookAliases[lookAlias] ?? lookAlias;
  return { voiceId, lookId };
}

/** spec.voiceModel, else brand.voiceModel, else "eleven_v3". */
export function resolveVoiceModel(spec: Spec, brand: Brand): string {
  return spec.voiceModel ?? brand.voiceModel ?? "eleven_v3";
}

/** spec.film, else brand.film, else undefined (the renderer treats undefined as 1 — full finish). */
export function resolveFilm(spec: Spec, brand: Brand): number | undefined {
  return spec.film ?? brand.film;
}

export function assertAssetsExist(spec: Spec, project: Project): void {
  for (const [i, seg] of spec.segments.entries()) {
    if (seg.kind !== "app") continue;
    if (!existsSync(project.assetPath(seg.asset))) {
      throw new Error(`Missing asset for segment[${i}]: assets/${seg.asset}`);
    }
    if (seg.frame && !existsSync(project.assetPath(seg.frame.src))) {
      throw new Error(`Missing frame for segment[${i}]: assets/${seg.frame.src}`);
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
    const raw = readFileSync(abs, "utf8");
    const violations = lintMotionSource(source, raw);
    if (violations.length) throw new Error(`Motion graphic ${where} (assets/${source}): ${violations.join("; ")}`);
  }
}

// SFX/music sources: every ref must resolve (library id or project asset) before any API spend.
export function assertAudioSources(spec: Spec, project: { assetPath(rel: string): string }): void {
  (spec.sfx ?? []).forEach((s, i) => {
    try {
      resolveAudioSource(s.src, project);
    } catch (e) {
      throw new Error(`sfx[${i}]: ${(e as Error).message}`);
    }
  });
  if (spec.music) {
    try {
      resolveAudioSource(spec.music.src, project);
    } catch (e) {
      throw new Error(`music: ${(e as Error).message}`);
    }
  }
}

export function validateSpec(spec: Spec, brand: Brand, project: Project): void {
  const hits = complianceScan(spec, brand);
  if (hits.length) {
    throw new Error("Compliance: banned phrases found — " + hits.map((h) => `"${h.phrase}" @ ${h.where}`).join("; "));
  }
  assertAssetsExist(spec, project);
  assertMotionGraphics(spec, project);
  assertAudioSources(spec, project);
}
