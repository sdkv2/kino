import { existsSync, readFileSync } from "node:fs";
import type { Brand } from "../config/brand.js";
import type { Spec } from "./schema.js";
import type { Project } from "../config/project.js";
import type { Provider } from "../avatar/provider.js";
import { lintMotionSource } from "../render/motiongraphic.js";
import { resolveAudioSource } from "../media/sfx.js";
import { resolveMotionSource } from "../media/motionLib.js";
import { log } from "../log.js";
import { KINO_VERSION } from "../version.js";
import { validateSegmentFx } from "../render/maskSpec.js";
import { validatePostFx } from "../render/postSpec.js";
import { validateLayers } from "../render/layerSpec.js";

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
// because a presenter-less build is valid, whereas resolveVoiceLook throws — a presenter build with no
// voice or look is unrecoverable, so it fails loud rather than producing a silent empty render.

/** spec.provider, else brand.defaultProvider, else "none" (no presenter). */
export function resolveProvider(spec: Spec, brand: Brand): Provider {
  return (spec.provider ?? brand.defaultProvider ?? "none") as Provider;
}

/**
 * Resolve the voice id: spec.voice, else brand.defaultVoice, mapped through brand.voiceAliases
 * (unknown alias passes through as a raw id). Returns '' when nothing is configured — a valid
 * "no voice" state for presenter-less builds, not an error.
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
    if (seg.voFile && !existsSync(project.assetPath(seg.voFile))) {
      throw new Error(`Missing voFile for segment[${i}]: assets/${seg.voFile}`);
    }
    if (seg.kind !== "video") continue;
    if (!existsSync(project.assetPath(seg.source))) {
      throw new Error(`Missing source for segment[${i}]: assets/${seg.source}`);
    }
    if (seg.frame && !existsSync(project.assetPath(seg.frame.src))) {
      throw new Error(`Missing frame for segment[${i}]: assets/${seg.frame.src}`);
    }
  }
}

// Motion graphics: every referenced file must resolve (library bare id or project asset) and pass
// the determinism/safety lint. Runs before VO generation so a bad graphic fails the build cheaply.
export function assertMotionGraphics(spec: Spec, project: { assetPath(rel: string): string }): void {
  const refs: { source: string; where: string }[] = [];
  spec.segments.forEach((seg, i) => {
    if (seg.kind === "motion") refs.push({ source: seg.source, where: `segment[${i}]` });
    const ov = (seg as { motionOverlay?: { source?: string } }).motionOverlay;
    if (ov?.source) refs.push({ source: ov.source, where: `segment[${i}].motionOverlay` });
    // regionShader texture channels take the same motion sources (a .html rasterized into uTexN),
    // so they get the same resolve + lint here rather than only at build time. Image channels are
    // plain assets and are checked where every other beat asset is.
    (seg as { regionShader?: { textures?: string[] } }).regionShader?.textures?.forEach((source, j) => {
      if (!/\.(png|jpe?g|webp)$/i.test(source)) refs.push({ source, where: `segment[${i}].regionShader.textures[${j}]` });
    });
  });
  for (const { source, where } of refs) {
    let abs: string;
    let fileName: string;
    let display: string;
    try {
      ({ abs, fileName, display } = resolveMotionSource(source, project));
    } catch (e) {
      throw new Error(`Missing motion graphic for ${where}: ${(e as Error).message}`);
    }
    const raw = readFileSync(abs, "utf8");
    const violations = lintMotionSource(fileName, raw);
    if (violations.length) throw new Error(`Motion graphic ${where} (${display}): ${violations.join("; ")}`);
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

const READY_PAIR: Record<string, string> = {
  "prompt-type": "loop-ready",
  "loop-ready": "prompt-type",
  "prompt-window": "loop-settle",
  "loop-settle": "prompt-window",
};

function motionBaseName(source: string): string {
  const base = source.split(/[/\\]/).pop() ?? source;
  return base.replace(/\.(js|html|json)$/i, "");
}

/** Soft guidance when seamlessLoop is set — throws only on hard structural mistakes. */
export function assertSeamlessLoop(spec: Spec, brand?: Brand): void {
  if (!spec.seamlessLoop) return;
  const last = spec.segments[spec.segments.length - 1];
  if (!last || last.kind !== "motion") {
    throw new Error('seamlessLoop requires the last segment to be kind:"motion" (settle to the ready-state)');
  }
  if (spec.film == null || spec.film > 0) {
    log.warn('seamlessLoop: set "film": 0 so the loop seam is not graded differently per encode');
  }
  if (last.text && last.text.trim().split(/\s+/).length <= 2) {
    log.warn("seamlessLoop: last beat VO is very short — settle may feel rushed");
  }
  const first = spec.segments[0];
  if (first?.kind === "motion") {
    const a = motionBaseName(first.source);
    const b = motionBaseName(last.source);
    const expect = READY_PAIR[a];
    if (expect && b !== expect) {
      log.warn(`seamlessLoop: first is "${a}" but last is "${b}" — pair with "${expect}" for a clean loop seam`);
    }
  }
  const bg = spec.background ?? brand?.background;
  if (bg === "mesh" || bg === "aurora" || bg === "particles" || bg === "grid") {
    log.warn(
      `seamlessLoop: background "${bg}" drifts on the global frame — prefer "solid" or "custom" ` +
        '(e.g. backgroundComponent: "brand-wash") and paint a static .bg in every motion beat',
    );
  }
}

/**
 * A beat with no `text` speaks nothing, so nothing derives its length — `dur` has to.
 *
 * `text` used to be mandatory on every beat, which meant a purely visual beat (a title card, a logo
 * sting, a shape morph) had to carry a line it would never speak just to satisfy the schema. That
 * line was not inert: it set the beat's length, and it produced word timings that any typed-in-sync
 * surface would then lock to, so an invented caption silently dictated on-screen pacing.
 */
export function assertBeatLengths(spec: Spec): void {
  const bad = spec.segments
    .map((seg, i) => ({ seg, i }))
    // A voFile beat takes its length from the audio file, so it needs neither text nor dur.
    .filter(({ seg }) => !seg.text?.trim() && !seg.voFile && seg.dur == null)
    .map(({ i }) => `segment[${i}]`);
  if (!bad.length) return;
  throw new Error(
    `${bad.join(", ")}: a beat with no "text" has nothing to derive its length from — give it ` +
      `"dur" (seconds) for a purely visual beat, or add "text" for it to speak.`,
  );
}

/** Soft nudge when background-led work is about to ship on stock mesh with no custom stage. */
export function assertBackgroundChoice(spec: Spec, brand: Brand): void {
  const bg = spec.background ?? brand.background ?? "glow";
  if (bg !== "mesh" && bg !== "aurora") return;
  const hasCustom = !!(spec.backgroundComponent ?? brand.backgroundComponent);
  if (hasCustom) return;
  const backgroundHeavy =
    spec.segments.filter((s) => s.kind === "scene" || s.kind === "motion").length >= 2;
  if (!backgroundHeavy) return;
  log.warn(
    `background "${bg}" is a stock preset — for brand identity prefer ` +
      `"background": "custom", "backgroundComponent": "brand-wash" (or your own draw fn). ` +
      "`kino backgrounds` lists options.",
  );
}

/**
 * Words-mode paints the SPOKEN text word-by-word — a segment `caption` string never appears there.
 * Both mock promos burned an iteration on this, so warn the moment a caption is authored under a
 * resolved words mode (brand < spec < segment) and differs from the spoken text.
 */
export function assertCaptionModes(spec: Spec, brand: Brand): void {
  spec.segments.forEach((seg, i) => {
    const mode = seg.captionMode ?? spec.captionMode ?? brand.captionMode ?? "phrase";
    if (mode !== "words") return;
    const cap = seg.caption?.trim();
    // A beat with no `text` speaks nothing, so words mode has nothing to paint and the caption is
    // the only line there is — never warn it away.
    if (!cap || !seg.text || cap === seg.text.trim()) return;
    log.warn(
      `segment[${i}]: caption is ignored under words mode (the spoken text paints word-by-word) — ` +
        `set "captionMode": "phrase" on this beat to show the caption, or drop it`,
    );
  });
}

// Bracket audio tags ([short pause], [softly], …) only work on eleven_v3 — other models speak them.
const AUDIO_TAG_RE = /\[[a-z][a-z0-9 \-]{0,40}\]/i;

export function assertVoiceTags(spec: Spec, brand: Brand): void {
  const model = resolveVoiceModel(spec, brand);
  if (model.startsWith("eleven_v3")) return;
  const hits: string[] = [];
  spec.segments.forEach((seg, i) => {
    if (seg.text && AUDIO_TAG_RE.test(seg.text)) hits.push(`segment[${i}]`);
  });
  if (!hits.length) return;
  log.warn(
    `Audio tags in ${hits.join(", ")} but voiceModel is "${model}" — non-v3 reads tags aloud ` +
      `("short pause", …). Switch to eleven_v3, or drop [brackets] and pause with punctuation.`,
  );
}

/** Soft warning when the spec was authored/built against a different kino version. */
export function assertKinoVersion(spec: Spec): void {
  if (spec.kinoVersion && spec.kinoVersion !== KINO_VERSION) {
    log.warn(`spec.kinoVersion "${spec.kinoVersion}" does not match installed kino ${KINO_VERSION} — behavior may differ`);
  }
}

export function validateSpec(spec: Spec, brand: Brand, project: Project): void {
  const hits = complianceScan(spec, brand);
  if (hits.length) {
    throw new Error("Compliance: banned phrases found — " + hits.map((h) => `"${h.phrase}" @ ${h.where}`).join("; "));
  }
  const fxErrors = spec.segments.flatMap((seg, i) => validateSegmentFx(seg, i));
  if (fxErrors.length) throw new Error(fxErrors.join("\n"));
  const layerErrors = validateLayers((spec as { layers?: unknown }).layers, spec.segments.length);
  if (layerErrors.length) throw new Error(layerErrors.join("\n"));
  const postErrors = validatePostFx((spec as { postFx?: unknown }).postFx);
  if (postErrors.length) throw new Error(postErrors.join("\n"));
  assertBeatLengths(spec);
  assertAssetsExist(spec, project);
  assertMotionGraphics(spec, project);
  assertAudioSources(spec, project);
  assertSeamlessLoop(spec, brand);
  assertBackgroundChoice(spec, brand);
  assertCaptionModes(spec, brand);
  assertVoiceTags(spec, brand);
  assertKinoVersion(spec);
}
