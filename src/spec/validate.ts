import { existsSync, readFileSync } from "node:fs";
import type { Brand } from "../config/brand.js";
import { musicBeds, type Spec } from "./schema.js";
import type { Project } from "../config/project.js";
import type { Provider } from "../avatar/provider.js";
import { lintMotionSource, type MotionSurface } from "../render/motiongraphic.js";
import { resolveAudioSource } from "../media/sfx.js";
import { resolveMotionSource } from "../media/motionLib.js";
import { resolveTransitionSource } from "../media/transitionLib.js";
import { parseHexColor } from "../render/transitionSource.js";
import { CAMERA_MOVES } from "../render/cameraSpec.js";
import { log } from "../log.js";
import { KINO_VERSION } from "../version.js";
import { validateSegmentFx } from "../render/maskSpec.js";
import { validatePostFx } from "../render/postSpec.js";
import { validateLayers } from "../render/layerSpec.js";
import { PALETTE_PRESET_NAMES, PALETTE_ROLES } from "../config/palettes.js";
import { isLightSurface } from "../render/contrast.js";

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

export interface MotionRef {
  source: string;
  where: string;
  surface: MotionSurface;
  /** Whether this ref goes through the determinism/safety lint. Background textures are rasterized
   *  DOM too — so they matter to anything reading font usage — but they are not linted here. */
  lint: boolean;
}

/** Every motion source a spec rasterizes, in one place. Shared so a consumer that has to see ALL
 *  of them (the font-cut scan in `build`) cannot drift out of sync with the one that lints them. */
export function collectMotionRefs(spec: Spec): MotionRef[] {
  const refs: MotionRef[] = [];
  spec.segments.forEach((seg, i) => {
    if (seg.kind === "motion") refs.push({ source: seg.source, where: `segment[${i}]`, surface: "beat", lint: true });
    const ov = (seg as { motionOverlay?: { source?: string } }).motionOverlay;
    if (ov?.source) refs.push({ source: ov.source, where: `segment[${i}].motionOverlay`, surface: "beat", lint: true });
    // regionShader texture channels take the same motion sources (a .html rasterized into uTexN),
    // so they get the same resolve + lint here rather than only at build time. Image channels are
    // plain assets and are checked where every other beat asset is.
    (seg as { regionShader?: { textures?: string[] } }).regionShader?.textures?.forEach((source, j) => {
      // `texture` surface: a rasterized channel advances its own @keyframes via the re-raster param,
      // so it must not be held to the per-element `.kino-anim` scrub rule a beat is held to.
      if (!/\.(png|jpe?g|webp)$/i.test(source)) {
        refs.push({ source, where: `segment[${i}].regionShader.textures[${j}]`, surface: "texture", lint: true });
      }
    });
  });
  // Shader background texture channels: an `.html` here is sanitized + rasterized with the brand
  // fonts and palette applied, exactly like a beat, so its type is real font usage.
  (spec.backgroundTextures ?? []).forEach((t, i) => {
    const source = typeof t === "string" ? t : t.source;
    if (!/\.(png|jpe?g|webp)$/i.test(source)) {
      refs.push({ source, where: `backgroundTextures[${i}]`, surface: "texture", lint: false });
    }
  });
  return refs;
}

// Motion graphics: every referenced file must resolve (library bare id or project asset) and pass
// the determinism/safety lint. Runs before VO generation so a bad graphic fails the build cheaply.
export function assertMotionGraphics(spec: Spec, project: { assetPath(rel: string): string }): void {
  for (const { source, where, surface } of collectMotionRefs(spec).filter((r) => r.lint)) {
    let abs: string;
    let fileName: string;
    let display: string;
    try {
      ({ abs, fileName, display } = resolveMotionSource(source, project));
    } catch (e) {
      throw new Error(`Missing motion graphic for ${where}: ${(e as Error).message}`);
    }
    const raw = readFileSync(abs, "utf8");
    const violations = lintMotionSource(fileName, raw, surface);
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
  const beds = musicBeds(spec);
  beds.forEach((bed, i) => {
    try {
      resolveAudioSource(bed.src, project);
    } catch (e) {
      throw new Error(`music${beds.length > 1 ? `[${i}]` : ""}: ${(e as Error).message}`);
    }
  });
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

/**
 * Nudge toward declaring a colour scheme — on the spec, or on a brand that actually sets `colors`.
 *
 * Falling back to the house palette used to be totally silent: a spec with no brand rendered in
 * kino's own navy/mint and looked deliberate, so the cheapest way to get five hex values of your
 * own was to scaffold an entire brand you had no other use for. This is only a warning (not a
 * throw) so an existing brandless spec keeps building — but the fallback now says so out loud.
 */
export function assertColorScheme(spec: Spec, brand: Brand): void {
  if (spec.colors != null || brand.colorsDeclared) return;
  log.warn(
    `No colour scheme — rendering in kino's house palette. Set "colors" on the spec — a preset ` +
      `(${PALETTE_PRESET_NAMES.map((n) => `"${n}"`).join(" | ")}), or the roles { ${PALETTE_ROLES.join(", ")} } ` +
      "— or assign a brand whose brand.md declares colors. Run `kino colors` to see the presets.",
  );
}

/** The cinematic finish darkens frame edges — on a light base that reads as a dirty border. */
export function assertLightSchemeFinish(spec: Spec, brand: Brand): void {
  const film = resolveFilm(spec, brand);
  if (!isLightSurface(brand.colors.bg) || film === 0) return;
  log.warn(
    `Light colour scheme (bg ${brand.colors.bg}) with the cinematic finish on — the vignette reads ` +
      'as a dirty border on a light base. Set "film": 0 for a clean, flat render.',
  );
}

/** Soft warning when the spec was authored/built against a different kino version. */
export function assertKinoVersion(spec: Spec): void {
  if (spec.kinoVersion && spec.kinoVersion !== KINO_VERSION) {
    log.warn(`spec.kinoVersion "${spec.kinoVersion}" does not match installed kino ${KINO_VERSION} — behavior may differ`);
  }
}

export function validateSpec(spec: Spec, brand: Brand, project: Project): void {
  assertColorScheme(spec, brand);
  const fxErrors = spec.segments.flatMap((seg, i) => validateSegmentFx(seg, i));
  if (fxErrors.length) throw new Error(fxErrors.join("\n"));
  const layerErrors = validateLayers((spec as { layers?: unknown }).layers, spec.segments.length);
  if (layerErrors.length) throw new Error(layerErrors.join("\n"));
  const postErrors = validatePostFx((spec as { postFx?: unknown }).postFx);
  if (postErrors.length) throw new Error(postErrors.join("\n"));
  assertBeatLengths(spec);
  assertAssetsExist(spec, project);
  assertMotionGraphics(spec, project);
  assertTransitions(spec, project);
  assertAudioSources(spec, project);
  assertSeamlessLoop(spec, brand);
  assertBackgroundChoice(spec, brand);
  assertCaptionModes(spec, brand);
  assertVoiceTags(spec, brand);
  assertLightSchemeFinish(spec, brand);
  assertKinoVersion(spec);
}

/** Knobs the `wipe` family understands. Anything else on a wipe is a typo, not a feature. */
const WIPE_KEYS = ["angle", "softness", "edgeWidth", "edgeColor", "edgeGain"];

/**
 * Transitions: a `custom` shader must resolve, and a built-in must not be handed params it will
 * silently ignore.
 *
 * The second half matters more than it looks. `transitionParams` has to accept unknown keys so a
 * custom shader can name its own uniforms — which means a misspelled `softnes` on a wipe would
 * otherwise parse fine and do nothing, the exact silent-no-op class this codebase keeps getting
 * bitten by. So the strictness moves here, where the transition kind is known.
 */
export function assertTransitions(spec: Spec, project: { assetPath(rel: string): string; workspaceRoot: string }): void {
  spec.segments.forEach((seg, i) => {
    const s = seg as { transition?: string; transitionSource?: string; transitionParams?: Record<string, unknown> };
    const where = `segment[${i}]`;
    // A misspelled move would silently render a still camera — the same silent-no-op class as a
    // misspelled wipe knob, so it fails here where the name is known.
    const cam = (seg as { transitionCamera?: { move?: string } }).transitionCamera;
    if (cam?.move && !(cam.move in CAMERA_MOVES)) {
      throw new Error(
        `${where}: transitionCamera.move "${cam.move}" is not a known move ` +
          `(${Object.keys(CAMERA_MOVES).join(", ")}). Run \`kino transitions\`.`,
      );
    }
    if (s.transitionSource && s.transition !== "custom") {
      throw new Error(
        `${where}: transitionSource needs transition:"custom" (got ${s.transition ? `"${s.transition}"` : "no transition"}). ` +
          `Built-in transitions ignore it — run \`kino transitions\` for the list.`,
      );
    }
    if (s.transition === "custom") {
      if (!s.transitionSource) {
        throw new Error(`${where}: transition:"custom" needs transitionSource (a bare library id or an assets/ path to a .frag). See \`kino transitions\`.`);
      }
      try {
        resolveTransitionSource(s.transitionSource, project);
      } catch (e) {
        throw new Error(`${where}: ${(e as Error).message}`);
      }
      // A custom shader names its own params, so there is no key list to police. One thing IS
      // checkable: a value that was plainly meant to be a colour but is malformed. Those reach the
      // shader as "not a colour", which silently falls back to the brand — a wrong-coloured render
      // with nothing in the log, which is the failure mode this file exists to prevent.
      for (const [k, v] of Object.entries(s.transitionParams ?? {})) {
        if (typeof v !== "string") continue;
        const looksLikeColor = v.trim().startsWith("#") || /^[0-9a-f]{6}$/i.test(v.trim());
        if (looksLikeColor && parseHexColor(v) === null) {
          throw new Error(
            `${where}: transitionParams.${k} = ${JSON.stringify(v)} looks like a colour but is not a valid hex ` +
              `(#rgb or #rrggbb). Omit it to use the brand's palette, or fix the value.`,
          );
        }
      }
      return;
    }
    const params = s.transitionParams;
    if (!params) return;
    const isWipeKind = s.transition === "wipe" || (s.transition ?? "").startsWith("wipe-");
    const unknown = Object.keys(params).filter((k) => !WIPE_KEYS.includes(k));
    if (isWipeKind && unknown.length) {
      throw new Error(
        `${where}: transitionParams ${unknown.map((k) => `"${k}"`).join(", ")} ` +
          `${unknown.length === 1 ? "is not a knob" : "are not knobs"} the wipe family understands ` +
          `(${WIPE_KEYS.join(", ")}). A wipe would ignore it silently.`,
      );
    }
    if (!isWipeKind) {
      throw new Error(
        `${where}: transitionParams only applies to the wipe family or transition:"custom" — ` +
          `"${s.transition ?? "the default"}" would ignore it. Run \`kino transitions\`.`,
      );
    }
  });
}
