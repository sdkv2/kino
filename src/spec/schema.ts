// THE SPEC CONTRACT. Zod schema for the agent-authored spec.json that drives a build: title,
// format, segments (scene/video/motion), captions, background, overlays, keyframes. This is the
// single source of truth for what an agent may author; keep it and docs/spec-reference.md in sync.
// Exports the Spec type used throughout the pipeline. Note: keyframe/trigger `at` is in seconds
// (resolved against frame/fps in the render layer).
import { readFileSync } from "node:fs";
import { z } from "zod";
import { CAPTION_STYLES, CAPTION_ANIMATIONS, CAPTION_REVEALS } from "../render/textStyles.js";
import { EASE_NAMES } from "../render/bgparams.js";
import { EXTRA_PARAM_SLOTS } from "../render/shaderSource.js";
import { PALETTE_PRESET_NAMES } from "../config/palettes.js";
import { LAYER_SOURCE_KINDS } from "../render/layerSpec.js";
import { resolveSpec, validateSegmentImages } from "./segmentImages.js";

const EaseEnum = z.enum(EASE_NAMES);

const PalettePresetEnum = z.enum(PALETTE_PRESET_NAMES);
const Hex = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "colour must be a hex like #1d4ed8");
/**
 * The spec's colour scheme: a preset name, or a block of roles that may name a preset to start
 * from. Legacy literal names (night/white/mint/gold/green) are accepted alongside the roles, same
 * as brand.md — one colour vocabulary across both files. Strict, so a typo'd role is an error
 * rather than a silently-ignored key.
 */
const SpecColors = z.union([
  PalettePresetEnum,
  z
    .object({
      preset: PalettePresetEnum.optional(),
      bg: Hex.optional(),
      fg: Hex.optional(),
      accent: Hex.optional(),
      accent2: Hex.optional(),
      deep: Hex.optional(),
      night: Hex.optional(),
      white: Hex.optional(),
      mint: Hex.optional(),
      gold: Hex.optional(),
      green: Hex.optional(),
    })
    .strict()
    .refine((c) => Object.keys(c).length > 0, "colors: {} declares nothing — name a preset or set roles"),
]);

const CaptionStyle = z.enum(CAPTION_STYLES);
const CaptionAnimation = z.enum(CAPTION_ANIMATIONS);
const CaptionReveal = z.enum(CAPTION_REVEALS);
const TextOverlaySpec = z.object({
  text: z.string().min(1),
  at: z.number().min(0),
  dur: z.number().positive().optional(),
  position: z.enum(["top", "center", "bottom", "left", "right"]).default("center"),
  size: z.enum(["small", "medium", "big"]).default("medium"),
  style: CaptionStyle.optional(),
  animation: CaptionAnimation.optional(),
  mask: z.unknown().optional(),
  effects: z.unknown().optional(),
});

const Kicker = z.object({
  text: z.string(),
  // Role names are canonical; the literal names are the pre-rename aliases (accent/mint,
  // deep/green, accent2/gold) — resolved to the same palette slots at render.
  color: z.enum(["accent", "deep", "accent2", "mint", "green", "gold"]).default("accent"),
});
const Shot = z.enum(["push-in", "pull-out", "pan-left", "pan-right", "tilt-up", "scroll", "scroll-up", "static"]);
/** Camera carried through a transition — composes with ANY transition kind. */
const TransitionCamera = z
  .object({
    // Named move: push | pull | pan-left | pan-right | tilt-up | tilt-down | whip-left | whip-right
    move: z.string().optional(),
    zoom: z.number().min(-0.9).max(2).optional(),   // >0 push in, <0 pull out
    panX: z.number().min(-1.5).max(1.5).optional(), // fraction of the frame
    panY: z.number().min(-1.5).max(1.5).optional(),
    amount: z.number().min(0).max(4).optional(),    // scales the whole move
    blur: z.number().min(0).max(4).optional(),      // directional smear along the travel
    // Fraction of each side spent AT full extent rather than travelling to it. 0 = a continuous
    // drift that only peaks at the boundary; higher = ramp, plateau, ramp — a punch that HOLDS.
    hold: z.number().min(0).max(0.95).optional(),
  })
  .strict();

/** Knobs for the `wipe` family, and free-form uniforms for `transition: "custom"`.
 *  Unknown keys are allowed here so a custom shader can name its own params; `assertTransitions`
 *  rejects an unknown key on a BUILT-IN transition, where it would silently do nothing. */
const TransitionParams = z
  .object({
    // Degrees of travel: 0 = down, 90 = right, 180 = up, 270 = left. Any angle is valid — the
    // shader normalises its projection axis, so a diagonal still runs fully off both edges.
    angle: z.number().optional(),
    softness: z.number().min(0).max(0.5).optional(), // reveal-edge feather, fraction of the frame
    edgeWidth: z.number().min(0).max(0.5).optional(), // lit band width; 0 = unlit, a clean reveal
    edgeColor: z.string().optional(), // hex; defaults to the brand mint
    edgeGain: z.number().min(0).max(4).optional(), // lit band brightness; 0 = unlit
  })
  .catchall(z.union([z.number(), z.string()]));

const Transition = z.enum([
  "fade", "dissolve", "fly-left", "fly-up", "pop", "cut",
  "wipe", "wipe-down", "wipe-up", "wipe-left", "wipe-right",
  // Author-supplied shader; pair with `transitionSource`. See `kino transitions`.
  "custom",
]);
const Provider = z.enum(["none", "heygen", "hedra", "replicate"]);
const Background = z.enum(["glow", "image", "mesh", "aurora", "particles", "grid", "solid", "custom"]);
const CaptionMode = z.enum(["phrase", "words"]);
const BgKeyframe = z.object({
  at: z.number(),
  params: z.record(z.union([z.number(), z.string()])),
  ease: EaseEnum.optional(),
});

/**
 * The channels `tweenAt` (render/layers.ts) actually reads off a caption/kicker/zoom track. Kept in
 * sync with the defaults object there — anything absent from this list is read by nobody.
 */
export const OVERLAY_TWEEN_PARAMS = ["x", "y", "scale", "opacity", "rotate", "scaleX", "scaleY", "anchorX", "anchorY"];

/**
 * An overlay tween track. Same shape as BgKeyframe, but its `params` bag is CLOSED: on these tracks
 * the channel set is fixed, so an unknown key is always a typo — and an open bag made that typo a
 * silent no-op (the spec validated, the render did nothing, and the author had no error to correct
 * against). Background and region-shader tracks keep the open BgKeyframe, where arbitrary author
 * param names are the entire point.
 */
const OverlayKeyframe = BgKeyframe.superRefine((kf, ctx) => {
  for (const key of Object.keys(kf.params)) {
    if (OVERLAY_TWEEN_PARAMS.includes(key)) continue;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["params"],
      message: `unrecognized tween param '${key}'${suggestKey(key, OVERLAY_TWEEN_PARAMS)} — valid: ${OVERLAY_TWEEN_PARAMS.join(", ")}`,
    });
  }
});

/** Extra stills composited on a video/motion beat — expanded to spec.layers[] at resolve time. */
const SegmentImageSchema = z
  .object({
    src: z.string().min(1).optional(),
    svg: z.string().min(1).optional(),
    id: z.string().min(1).optional(),
    rect: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).strict().optional(),
    opacity: z.number().min(0).max(1).optional(),
    flipX: z.boolean().optional(),
    flipY: z.boolean().optional(),
    blend: z.enum(["normal", "screen", "multiply", "add"]).optional(),
    z: z.number().optional(),
    keyframes: z.array(OverlayKeyframe).optional(),
    drive: z.record(z.string()).optional(),
  })
  .strict()
  .superRefine((img, ctx) => {
    if (!img.src && !img.svg) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "needs src (file path) or svg (inline markup)" });
    }
  });

const BgTrigger = z.object({ at: z.number(), action: z.string() });

/**
 * A declared layer (`spec.layers[]`) — SHAPE ONLY: required fields, primitive types, and a closed
 * key set. The semantics stay in `validateLayers` (render/layerSpec.ts): reserved ids, reserved z
 * values, source-vs-adjust exclusivity, blend/opacity ranges, beat-range checks, mask rules. One
 * owner per question — "is this the right shape?" here, "does it make sense?" there — so the two
 * never race to report the same problem in different words.
 *
 * `mask`, `effects` and `adjust` stay unknown on purpose: maskSpec.ts owns them, and restating
 * their per-kind params here would duplicate that validator and risk rejecting what it accepts.
 */
const DeclaredLayerSourceBase = z
  .object({
    kind: z.enum(LAYER_SOURCE_KINDS),
    src: z.string().min(1).optional(),
    svg: z.string().min(1).optional(),
    // The SOURCE's own params (shader uniforms, motion-graphic knobs) — arbitrary author names, so
    // this bag stays open. Not to be confused with the layer's `keyframes` below, which drive the
    // fixed transform channels and are closed.
    params: z.record(z.union([z.number(), z.string()])).optional(),
    keyframes: z.array(BgKeyframe).optional(),
    triggers: z.array(BgTrigger).optional(),
  })
  .strict();

const DeclaredLayerSource = DeclaredLayerSourceBase.superRefine((s, ctx) => {
  if (!s.src && !s.svg) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "source needs src or svg" });
  }
  if (s.svg && s.kind !== "image") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "source.svg is only supported on image layers" });
  }
});

const DeclaredLayer = z
  .object({
    id: z.string().min(1),
    z: z.number(),
    source: DeclaredLayerSource.optional(),
    adjust: z.array(z.unknown()).optional(),
    blend: z.string().optional(),
    fromSec: z.number().optional(),
    toSec: z.number().optional(),
    // Percent of frame, like every other rect in the spec.
    rect: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).strict().optional(),
    opacity: z.number().optional(),
    mask: z.unknown().optional(),
    effects: z.array(z.unknown()).optional(),
    // The layer's own transform tween — same fixed channel set as captionKeyframes, and closed for
    // the same reason: `tweenAt` reads nine names and silently ignores anything else.
    keyframes: z.array(OverlayKeyframe).optional(),
    segment: z.number().optional(),
    hold: z.boolean().optional(),
    flipX: z.boolean().optional(),
    flipY: z.boolean().optional(),
    drive: z.record(z.string()).optional(),
  })
  .strict();
// Numeric author-param names that consume a uParam slot — the union across a base dict and every
// keyframe, since a slot is allocated for any name that appears anywhere (extraParamNames derives
// the same set). colorA/colorB/colorC/intensity drive their own uniforms and cost nothing.
const RESERVED_SHADER_PARAMS = new Set(["colorA", "colorB", "colorC", "intensity"]);
function slotParamNames(
  base: Record<string, number | string> | undefined,
  keyframes: { params: Record<string, number | string> }[] | undefined,
): string[] {
  const names = new Set<string>();
  for (const src of [base ?? {}, ...(keyframes ?? []).map((k) => k.params)]) {
    for (const [k, v] of Object.entries(src)) if (!RESERVED_SHADER_PARAMS.has(k) && typeof v === "number") names.add(k);
  }
  return [...names].sort();
}
// Motion tracks may anchor to a spoken word instead of hand-copied seconds: atWord "match" (first
// case/punctuation-insensitive occurrence) or a word index. Resolved against the beat's VO word
// timings at build, so the anchor rides real TTS timing — no mock→real retune. Exactly one of
// at / atWord per entry.
const oneAnchor = (k: { at?: number; atWord?: string | number }) => (k.at != null) !== (k.atWord != null);
const anchorMsg = { message: "set exactly one of at / atWord" };
const AtWord = z.union([z.string().min(1), z.number().int().min(0)]);
const MotionKeyframe = z
  .object({
    at: z.number().optional(),
    atWord: AtWord.optional(),
    params: z.record(z.union([z.number(), z.string()])),
    ease: EaseEnum.optional(),
  })
  .refine(oneAnchor, anchorMsg);
const MotionTrigger = z.object({ at: z.number().optional(), atWord: AtWord.optional(), action: z.string() }).refine(oneAnchor, anchorMsg);
const motionFields = {
  source: z.string().min(1),
  params: z.record(z.union([z.number(), z.string()])).optional(),
  keyframes: z.array(MotionKeyframe).optional(),
  triggers: z.array(MotionTrigger).optional(),
  loop: z.boolean().optional(), // Tier-3 Lottie playback; inert for html/proc graphics
};
const MotionGraphicRef = z.object(motionFields);

const SfxEvent = z
  .object({
    src: z.string().min(1), // bare library id ("pop") or project asset path ("sfx/hit.mp3")
    at: z.number().min(0), // seconds on the main timeline
    volume: z.number().min(0).max(1).default(1),
  })
  .strict();
const Music = z
  .object({
    src: z.string().min(1), // same resolution as sfx.src
    volume: z.number().min(0).max(1).default(0.12), // bed level (short-form: quiet under VO)
    duck: z.number().min(0).max(1).default(0.04), // level while VO is speaking
    fadeInSec: z.number().min(0).default(0), // head fade (avoids a click on loop-audio starts)
    fadeOutSec: z.number().min(0).default(2),
    startSec: z.number().min(0).default(0), // play the bed from this offset into the file (`kino sync --offset auto` sets it to a beat)
  })
  .strict();

// Imported real voiceover for a beat: a project audio asset used instead of TTS. Word timings
// come from STT on real builds (Scribe with an ElevenLabs key, else local whisper.cpp; KINO_STT
// forces either); mock builds pace the spec text across the file's true duration.
const VoFile = z.string().min(1);

// Video sources that are GENERATED rather than read off disk: "avatar:" uses the configured
// provider (spec.provider → brand.defaultProvider → project.json), the named schemes pin one.
// Anything else is an asset path under the project's assets/.
export const PRESENTER_SCHEMES = ["avatar", "heygen", "hedra", "replicate"] as const;
const PRESENTER_RE = new RegExp(`^(${PRESENTER_SCHEMES.join("|")}):`);
export const isPresenterSource = (source: string | undefined): boolean =>
  !!source && PRESENTER_RE.test(source);

// Legacy kinds, normalized before the union sees them. "avatar" was the default beat back when
// kino only made presenter-led ads; it is a plain scene now, with the presenter as one video
// source among many. Old specs keep working — an "avatar" beat still resolves the configured
// provider, and resolves to nothing when that provider is "none", exactly as it did before.
const LEGACY_KINDS: Record<string, string> = { avatar: "scene", app: "video" };
const normalizeSegment = (raw: unknown): unknown => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
  const seg = { ...(raw as Record<string, unknown>) };
  if (seg.kind === undefined) seg.kind = "scene";
  if (typeof seg.kind !== "string") return seg;
  if (seg.kind === "avatar") {
    seg.kind = "scene";
    // Only mark it as presenter-seeking if the author did not already say otherwise.
    if (seg.source === undefined) seg.source = "avatar:";
  } else if (seg.kind === "app") {
    seg.kind = "video";
    if (seg.source === undefined && seg.asset !== undefined) seg.source = seg.asset;
    delete seg.asset;
  } else if (LEGACY_KINDS[seg.kind]) {
    seg.kind = LEGACY_KINDS[seg.kind];
  }
  // A presenter is generated over the background rather than composited off disk, so a video
  // beat pointing at one IS a scene with a presenter. Collapsing it here keeps the authoring
  // surface unified (one `kind: "video"`) without every render path re-deciding what a source is.
  if (seg.kind === "video" && isPresenterSource(seg.source as string | undefined)) seg.kind = "scene";
  return seg;
};

// Kept permissive here so the shared CLI validator can report mask/effect errors in its
// actionable beat-indexed form instead of Zod rejecting or stripping the authored values.
const segmentFxFields = {
  mask: z.unknown().optional(),
  effects: z.unknown().optional(),
  // Kept permissive here too — see src/render/layerSpec.ts, which validates in the author's
  // vocabulary rather than Zod's.
  blend: z.unknown().optional(),
};

/** Per-beat TTS voice override — falls back to spec.voice, then brand.defaultVoice. */
const segmentVoiceFields = {
  voice: z.string().min(1).optional(),
  voiceModel: z.string().min(1).optional(),
};

const SegmentUnion = z.discriminatedUnion("kind", [
  z.object({
    // A beat over the background: voiceover, captions, overlays. The default — omit `kind`.
    kind: z.literal("scene"),
    // Optional presenter video ("avatar:" for the configured provider, or "heygen:"/"hedra:"/
    // "replicate:" to pin one). Resolves to nothing when the provider is "none".
    source: z.string().min(1).optional(),
    // The line this beat speaks. OPTIONAL: omit it for a beat that is purely visual (a title
    // card, a logo sting, a shape morph) and give `dur` instead — the beat then has no VO, no
    // words, and no caption, and its length is exactly `dur`. Under real TTS an omitted `text`
    // costs nothing and renders as silence, so a mixed spec can speak on some beats only.
    text: z.string().min(1).optional(),
    voFile: VoFile.optional(),
    dur: z.number().positive().optional(), // fixed beat length (s) when no speech drives it (a silent build — the default). Real TTS length wins under --tts when the beat speaks.
    caption: z.string().optional(), // omit → no on-screen line for this beat (VO still speaks `text`)
    shot: Shot.optional(),
    captionMode: CaptionMode.optional(),
    emphasis: z.array(z.string()).optional(),
    captionKeyframes: z.array(OverlayKeyframe).optional(),
    motionOverlay: MotionGraphicRef.optional(),
    captionStyle: CaptionStyle.optional(),
    captionAnimation: CaptionAnimation.optional(),
    captionReveal: CaptionReveal.optional(),
    texts: z.array(TextOverlaySpec).optional(),
    ...segmentVoiceFields,
    ...segmentFxFields,
  })
  .strict(),
  z.object({
    // Footage, stills, or a generated presenter — whatever the `source` resolves to.
    kind: z.literal("video"),
    // Asset path under the project's assets/ (.mp4/.mov/.jpg/.png), or a presenter scheme
    // ("avatar:", "heygen:", "hedra:", "replicate:").
    source: z.string().min(1),
    // The line this beat speaks. OPTIONAL: omit it for a beat that is purely visual (a title
    // card, a logo sting, a shape morph) and give `dur` instead — the beat then has no VO, no
    // words, and no caption, and its length is exactly `dur`. Under real TTS an omitted `text`
    // costs nothing and renders as silence, so a mixed spec can speak on some beats only.
    text: z.string().min(1).optional(),
    voFile: VoFile.optional(),
    dur: z.number().positive().optional(), // fixed beat length (s) when no speech drives it (a silent build — the default). Real TTS length wins under --tts when the beat speaks.
    caption: z.string().optional(), // omit → no on-screen line for this beat (VO still speaks `text`)
    kicker: Kicker.optional(),
    shot: Shot.optional(),
    transition: Transition.optional(),
    transitionParams: TransitionParams.optional(), // wipe knobs, or a custom shader's own uniforms
    transitionSource: z.string().min(1).optional(), // with transition:"custom" — bare id or assets/ path to a .frag
    transitionInvert: z.boolean().optional(), // run the transition backwards (a reveal becomes a conceal)
    transitionCamera: TransitionCamera.optional(), // camera carried through the cut
    // Keep THIS beat's motion running through the transition that follows it. By default an
    // outgoing motion beat is held on its last authored frame for the whole handoff, so a graphic
    // that is still moving when the cut starts appears to stop dead under the transition. Opt in
    // when the motion should carry into the cut (a spin that whips away, drift that keeps drifting).
    // `--progress` and every eased curve still settle at 1 either way — only the real-time clock
    // (`--t`, `env.t`) and the raster keep advancing. Costs one raster per handoff frame.
    carryMotion: z.boolean().optional(),
    // Source-footage slice + retiming (importing-footage skill). Seconds into the asset.
    clipFrom: z.number().min(0).optional(),
    clipTo: z.number().min(0).optional(),
    speed: z.number().positive().default(1), // asset playback rate; tune after beats exist
    pauseAt: z.number().min(0).optional(), // seconds from segment start → freeze for rest of beat
    // Optional chrome: footage draws in inset (% of composition); src is a full-bleed PNG/WebP on top.
    frame: z
      .object({
        src: z.string().min(1),
        inset: z.object({
          x: z.number().min(0).max(100),
          y: z.number().min(0).max(100),
          w: z.number().positive().max(100),
          h: z.number().positive().max(100),
        }),
      })
      .optional(),
    // Per-mask-region shaders: the segmentation mask(s) split this beat's frame — each mask's region
    // (its channel >0.5) runs a .frag body, the background region (no mask selected) another.
    // `mask`+`object` is the single-mask shorthand; `masks` (up to 4 entries) is the general form.
    // An entry's own `subject` shades JUST that mask (per-object regions — two tracked objects,
    // two materials); entries without one fall back to the top-level `subject`, so several masks
    // can still share one treatment (e.g. two separately `kino segment`-ed subjects cut onto one
    // background). Where two masks overlap the LATER entry paints over the earlier one.
    // Exactly one of mask/masks required, and at least one shader body somewhere.
    regionShader: z
      .object({
        mask: z.string().min(1).optional(), // mask asset dir, e.g. "masks/clip"
        object: z.number().int().min(0).max(3).default(0), // manifest object → channel, for `mask`
        masks: z
          .array(
            z.object({
              mask: z.string().min(1),
              object: z.number().int().min(0).max(3).default(0),
              subject: z.string().min(1).optional(), // .frag/.glsl body for THIS mask's region only
            }),
          )
          .min(1)
          .max(4)
          .optional(),
        subject: z.string().min(1).optional(), // .frag/.glsl body; masks without their own
        background: z.string().min(1).optional(), // .frag/.glsl body; region where none are
        // A SECOND source for the BACKGROUND region: the subject stays the beat's own asset, the
        // background shows this clip instead — a segmented subject cut onto footage that isn't the
        // beat's. Project-relative image or video; video routes through the per-beat /vframes
        // pipeline (a <video> seek never advances under headless capture, which is exactly why the
        // page-global backgroundTextures video channel is still frozen). One per beat: there is one background region.
        backdrop: z.string().min(1).optional(),
        // Author params shared by EVERY body in this beat's program — there is ONE uParam0..3 bank
        // in the single program the subject, background and per-mask bodies share. Numeric
        // non-reserved names alias to `u_<name>`; colorA/colorB/colorC (hex) and intensity drive
        // uColorA/B/C + uIntensity instead and cost no slot. Max 4 numeric names across params +
        // keyframes — build throws above that rather than silently dropping the extras.
        params: z.record(z.union([z.number(), z.string()])).optional(),
        // Beat-relative track — `at` is seconds from THIS segment's start (like zoomKeyframes), so
        // it rides the beat when VO timing shifts. RegionShader's clock is already beat-local, and
        // this shares it with iTime. NOT absolute like backgroundKeyframes.
        keyframes: z.array(BgKeyframe).optional(),
        // Extra sampler channels shared by every body in the beat: textures[i] → uTex{i+2} (uTex0 is
        // the beat's own asset, uTex1 the cutout `backdrop`). An image uploads once; a motion .html
        // rasterizes at composition size every frame, scrubbed by the beat's progress — a motion
        // graphic the shader can SAMPLE rather than one composited above it (that is `motionOverlay`,
        // which still works alongside). Max 2: uTex2..uTex3 are what the region program has left.
        textures: z.array(z.string().min(1)).max(2).optional(),
      })
      // Strict so a mistyped or not-yet-supported key (e.g. `triggers` — no one-shot surface this
      // phase) fails loudly instead of being stripped into an unexplained still frame.
      .strict()
      .refine((v) => v.mask || v.masks, { message: "regionShader needs mask or masks" })
      // A backdrop counts: `mask` + `backdrop` with no .frag anywhere is the whole cutout spec.
      .refine((v) => v.subject || v.background || v.backdrop || v.masks?.some((m) => m.subject), {
        message: "regionShader needs at least one of subject/background/backdrop (top-level or per-mask)",
      })
      // Every body in the beat shares ONE uParam0..3 bank, so the cap is on the union of numeric
      // names across params + keyframes. extraParamNames would silently slice the extras away and
      // leave up to six bodies reading a param that never arrives — a build error is cheaper.
      .refine((v) => slotParamNames(v.params, v.keyframes).length <= EXTRA_PARAM_SLOTS, (v) => ({
        message:
          `regionShader has ${slotParamNames(v.params, v.keyframes).length} numeric params ` +
          `(${slotParamNames(v.params, v.keyframes).join(", ")}) but only ${EXTRA_PARAM_SLOTS} uParam slots exist — ` +
          `every region body shares one bank. colorA/colorB/colorC/intensity are free.`,
      }))
      .optional(),
    captionMode: CaptionMode.optional(),
    emphasis: z.array(z.string()).optional(),
    captionKeyframes: z.array(OverlayKeyframe).optional(),
    kickerKeyframes: z.array(OverlayKeyframe).optional(),
    // Camera push/pan on the whole footage+chrome group (the "canvas zoom" for inset device footage).
    // Beat-relative track — `at` is seconds from THIS segment's start (like captionKeyframes), so it
    // rides the beat when VO timing shifts; params x/y/scale/opacity.
    zoomKeyframes: z.array(OverlayKeyframe).optional(),
    motionOverlay: MotionGraphicRef.optional(),
    captionStyle: CaptionStyle.optional(),
    captionAnimation: CaptionAnimation.optional(),
    captionReveal: CaptionReveal.optional(),
    texts: z.array(TextOverlaySpec).optional(),
    images: z.array(SegmentImageSchema).max(8).optional(),
    ...segmentVoiceFields,
    ...segmentFxFields,
  })
  .strict(),
  z.object({
    kind: z.literal("motion"),
    ...motionFields,
    // The line this beat speaks. OPTIONAL: omit it for a beat that is purely visual (a title
    // card, a logo sting, a shape morph) and give `dur` instead — the beat then has no VO, no
    // words, and no caption, and its length is exactly `dur`. Under real TTS an omitted `text`
    // costs nothing and renders as silence, so a mixed spec can speak on some beats only.
    text: z.string().min(1).optional(),
    voFile: VoFile.optional(),
    dur: z.number().positive().optional(), // fixed beat length (s) when no speech drives it (a silent build — the default). Real TTS length wins under --tts when the beat speaks.
    caption: z.string().optional(),
    // Motion→motion handoff. Default = dissolve (hold + xfade). `"cut"` abuts with no backdrop gap.
    // `"wipe-down"` (and the rest of the wipe family) uncovers this beat behind a travelling edge.
    transition: Transition.optional(),
    transitionParams: TransitionParams.optional(), // wipe knobs, or a custom shader's own uniforms
    transitionSource: z.string().min(1).optional(), // with transition:"custom" — bare id or assets/ path to a .frag
    transitionInvert: z.boolean().optional(), // run the transition backwards (a reveal becomes a conceal)
    transitionCamera: TransitionCamera.optional(), // camera carried through the cut
    // Keep THIS beat's motion running through the transition that follows it. By default an
    // outgoing motion beat is held on its last authored frame for the whole handoff, so a graphic
    // that is still moving when the cut starts appears to stop dead under the transition. Opt in
    // when the motion should carry into the cut (a spin that whips away, drift that keeps drifting).
    // `--progress` and every eased curve still settle at 1 either way — only the real-time clock
    // (`--t`, `env.t`) and the raster keep advancing. Costs one raster per handoff frame.
    carryMotion: z.boolean().optional(),

    captionMode: CaptionMode.optional(),
    emphasis: z.array(z.string()).optional(),
    captionKeyframes: z.array(OverlayKeyframe).optional(),
    captionStyle: CaptionStyle.optional(),
    captionAnimation: CaptionAnimation.optional(),
    captionReveal: CaptionReveal.optional(),
    texts: z.array(TextOverlaySpec).optional(),
    motionOverlay: MotionGraphicRef.optional(),
    images: z.array(SegmentImageSchema).max(8).optional(),
    ...segmentVoiceFields,
    ...segmentFxFields,
  })
  .strict(),
]);

// `kind` is optional (omit it for a scene) and the pre-1.22 kinds still parse, so normalize
// before the discriminated union — which needs the discriminator present and current.
const Segment = z.preprocess(normalizeSegment, SegmentUnion);

// Named so the key list is derivable for "did you mean …?" — .superRefine() below wraps this in a
// ZodEffects, which no longer exposes .shape.
const SpecObject = z
  .object({
    brand: z.string().optional(), // falls back to the project's project.json brand
    // Colour scheme: "midnight" | "noir" | "paper", or { preset?, bg?, fg?, accent?, accent2?, deep? }.
    // A named preset replaces all five roles; role keys in the same block override it. Required
    // unless a brand declares colours — see assertColorScheme in spec/validate.ts. `kino colors`.
    colors: SpecColors.optional(),
    title: z.string().regex(/^[a-z0-9-]+$/, "title must be kebab-case"),
    kinoVersion: z.string().optional(), // kino version this spec was authored/built against — mismatch warns, doesn't fail
    // `*-4k` = UHD canvas (e.g. 9:16-4k → 2160×3840). Same aspect as the 1080-class twin.
    format: z.array(z.enum(["9:16", "3:4", "16:9", "9:16-4k", "3:4-4k", "16:9-4k"])).default(["9:16"]),
    // Composition frame rate. 30 suits talking-head and motion work and keeps render cost down,
    // but it resamples higher-rate source: 60fps footage (and a 60fps segmentation mask tracking
    // it) lands on every other frame. Raise it to carry that cadence through — cost scales with
    // it, since every frame is a real browser paint.
    fps: z.number().int().min(1).max(120).optional(),
    voice: z.string().optional(),
    // Extra cuts of the brand font to stage, so `font-weight` in a motion page selects a real face
    // instead of silently reusing the single caption cut. Overrides brand `fontWeights` (it does not
    // merge) — an empty array opts this spec out of a type-heavy brand's set. Each cut is
    // base64-inlined into every raster, so ask for what you use.
    fontWeights: z.array(z.number().int().min(100).max(900)).optional(),
    // TTS model. Default eleven_v3 (audio tags like [excited] work). Opt into
    // eleven_multilingual_v2 for metronome-critical / timing-stable reads.
    voiceModel: z.string().optional(),
    // Cinematic-finish intensity (vignette + grain over photographic/app beats), 0..1. Default 1
    // (graded film look). Set 0 for a clean, flat video — e.g. a light "paper" brand where the edge
    // vignette reads as a dark border. Motion-graphic beats are never graded (they own their finish).
    film: z.number().min(0).max(1).optional(),
    // Automatic camera motion blur on fast moves, default true. A pan or push that displaces the
    // frame by more than ~2.5px/frame gets a derived directional/radial smear, so the move reads as
    // expensive rather than as a jump. Set false for a deliberately crisp, snappy look (or when a
    // beat's own hand-authored blur should be the only smear).
    motionBlur: z.boolean().optional(),
    avatarLook: z.string().optional(), // heygen: look alias/id · hedra/replicate: portrait image path/url
    provider: Provider.optional(), // overrides brand.defaultProvider
    background: Background.optional(), // overrides brand.background
    backgroundIntensity: z.number().min(0).max(1).optional(), // 0..1 motion strength override
    backgroundKeyframes: z.array(BgKeyframe).optional(), // agent-driven param tweens over time
    backgroundTriggers: z.array(BgTrigger).optional(), // agent-driven one-shot actions (e.g. pulse)
    // Custom Canvas2D draw fn when background is "custom". Bare id → assets-lib/backgrounds/;
    // path → project assets/ or workspace (overrides brand.backgroundComponent).
    backgroundComponent: z.string().min(1).optional(),
    // Texture channels for shader backgrounds (uTex0..uTex3): project asset paths. Images
    // (.png/.jpg/.webp) upload as-is; motion HTML (.html) is sanitized and rasterized once at
    // load (foreignObject) — brand fonts + palette vars apply. An object entry with `param`
    // re-rasterizes the html EVERY FRAME at that background param's value (0..1 → the markup's
    // 1s CSS @keyframes) — true per-frame animation, no stepping. See docs/spec-reference.md.
    backgroundTextures: z
      .array(
        z.union([
          z.string().min(1),
          z.object({ source: z.string().min(1), param: z.string().min(1) }),
          // A video source (e.g. a segmentation mask.mp4) sampled per composition frame into uTexN.
          z.object({ source: z.string().min(1), kind: z.literal("video") }),
        ]),
      )
      .max(4)
      .optional(),
    captionStyle: CaptionStyle.optional(), // caption look preset (overrides brand.captionStyle.style)
    captionAnimation: CaptionAnimation.optional(), // caption entrance preset (overrides brand.captionStyle.animation)
    captionReveal: CaptionReveal.optional(), // words-mode reveal: "word" (default) | "all" (whole line laid out, highlight tracks VO)
    captionMode: CaptionMode.optional(), // "phrase" | "words" — spec-wide caption mode (brand < spec < segment)
    sfx: z.array(SfxEvent).optional(), // free-placed sound effects (place with `kino audio-markers`)
    music: Music.optional(), // music bed under the VO, auto-ducked while segments speak
    // Web/hero loop: last beat should settle to the first-frame ready-state. Enables validate
    // guidance + a post-build first/last-frame seam check (warn only). Not the same as segment
    // `loop` (Lottie playback).
    seamlessLoop: z.boolean().optional(),
    postFx: z.unknown().optional(),
    // Kept permissive here so the shared CLI validator reports layer errors in the author's
    // vocabulary rather than Zod's. See src/render/layerSpec.ts.
    layers: z.array(DeclaredLayer).optional(),
    segments: z.array(Segment).min(1),
  })
  .strict(); // reject unknown top-level keys — a misplaced/misspelled key errors instead of silently no-op'ing

/** Every top-level spec key — the candidate set for a mistyped spec field. */
const SPEC_KEYS = Object.keys(SpecObject.shape);

export const SpecSchema = SpecObject
  .superRefine((spec, ctx) => {
    // A scene's `source` only ever names a presenter — footage belongs to a video beat, which
    // carries the clip/speed/frame knobs a scene has no use for.
    spec.segments.forEach((seg, i) => {
      if (seg.kind !== "scene" || !seg.source) return;
      if (!isPresenterSource(seg.source)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `scene source must be a presenter ("${PRESENTER_SCHEMES.join(':", "')}:") — use kind "video" for footage and stills`,
          path: ["segments", i, "source"],
        });
      }
    });
    // Kept off the video object so discriminatedUnion stays a plain ZodObject (ZodEffects breaks it).
    spec.segments.forEach((seg, i) => {
      if (seg.kind !== "video") return;
      if (seg.clipTo != null && seg.clipFrom != null && !(seg.clipTo > seg.clipFrom)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "clipTo must be > clipFrom", path: ["segments", i, "clipTo"] });
      }
      if (seg.clipTo != null && seg.clipFrom == null && seg.clipTo <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "clipTo must be > 0 when clipFrom is omitted",
          path: ["segments", i, "clipTo"],
        });
      }
      const inset = seg.frame?.inset;
      if (inset && (inset.x + inset.w > 100 || inset.y + inset.h > 100)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "frame.inset x+w and y+h must be ≤ 100",
          path: ["segments", i, "frame", "inset"],
        });
      }
    });
  });

export type Spec = z.infer<typeof SpecSchema>;
export type Segment = z.infer<typeof Segment>;

/** Top-level / brand fields agents often park on a segment by mistake. */
const TOP_LEVEL_KEYS: Record<string, string> = {
  film: "film is top-level — not a segment field",
  seamlessLoop: "seamlessLoop is top-level — not a segment field",
  background: "background is top-level (or brand.md) — not a segment field",
  backgroundIntensity: "backgroundIntensity is top-level — not a segment field",
  backgroundKeyframes: "backgroundKeyframes is top-level — not a segment field",
  backgroundTriggers: "backgroundTriggers is top-level — not a segment field",
  music: "music is top-level — not a segment field",
  sfx: "sfx is top-level — not a segment field",
  fontWeights: "fontWeights is top-level (or brand.md) — not a segment field",
  provider: "provider is top-level (or brand/project) — not a segment field",
  avatarLook: "avatarLook is top-level (or brand.md) — not a segment field",
};

/** Keys valid on some segment kinds but rejected on others (strict). */
const SEGMENT_KIND_HINTS: Record<string, string> = {
  transition: "transition is video or motion (motion default = dissolve; use \"cut\" for hard abut)",
  asset: "asset was renamed to source (video beats)",
  clipFrom: "clipFrom/clipTo are video-only (importing-footage)",
  clipTo: "clipFrom/clipTo are video-only (importing-footage)",
  speed: "speed is video-only",
  pauseAt: "pauseAt is video-only",
  frame: "frame chrome is video-only",
  kicker: "kicker is video-only",
  zoomKeyframes: "zoomKeyframes is video-only",
  kickerKeyframes: "kickerKeyframes is app-only",
  source: "source is motion-only (or motionOverlay on avatar/app)",
  triggers: "triggers are motion-only (or motionOverlay / top-level backgroundTriggers)",
  keyframes: "keyframes are motion-only (or motionOverlay)",
  params: "params are motion-only (or motionOverlay)",
  loop: "loop is motion/Lottie-only",
  motionOverlay: "motionOverlay layers a second motion graphic on this beat (video/scene/motion)",
};

/**
 * Optimal string alignment distance — Levenshtein plus one extra move: a swapped adjacent pair
 * costs 1, not 2. Transposition is one of the most common ways to mistype a key (`opactiy` for
 * `opacity`, `heigth` for `height`), and under plain Levenshtein it scores the same as two
 * unrelated substitutions, which is exactly where a useful suggestion gets suppressed.
 * Only ever called on short spec key names, so the quadratic table is free.
 */
function editDistance(a: string, b: string): number {
  const n = b.length;
  let prev2: number[] = [];
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(n + 1);
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        cur[j] = Math.min(cur[j], prev2[j - 2] + 1);
      }
    }
    prev2 = prev;
    prev = cur;
  }
  return prev[n];
}

/**
 * ` — did you mean 'dur'?` for a near-miss, else "". A wrong key is nearly always a typo or a
 * remembered-from-elsewhere name, and the valid set is right here — so say it, rather than making
 * the author go re-read the reference to find a one-character difference.
 */
export function suggestKey(key: string, candidates: Iterable<string>): string {
  let best: string | null = null;
  let bestDist = Infinity;
  const lower = key.toLowerCase();
  for (const c of candidates) {
    if (c === key) continue;
    const cl = c.toLowerCase();
    let d: number;
    if (cl === lower) {
      d = 0.5; // case-only slip (captionkeyframes) — an exact hit, not a fuzzy one
    } else if (lower.length >= 3 && cl.length >= 3 && (lower.startsWith(cl) || cl.startsWith(lower))) {
      // Longer/shorter spelling of the same word: `duration` for `dur`. Edit distance scores these
      // terribly (5 apart) even though they are among the likeliest misses. Charged per character
      // of length gap so a prefix never outranks a genuine near-match — `captionKeyfrmes` must
      // resolve to `captionKeyframes` (1 edit), not to its own prefix `caption`.
      d = 0.5 + Math.abs(cl.length - lower.length) / 4;
    } else {
      d = editDistance(lower, cl);
    }
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  // Scale the tolerance with the word: 2 edits is a typo in "backgroundKeyframes", a different
  // word in "at".
  const limit = Math.min(3, Math.max(1, Math.floor(key.length / 4)));
  return best && bestDist <= limit ? ` — did you mean '${best}'?` : "";
}

/** Every key valid on any segment kind — the candidate set for a mistyped segment field. */
const SEGMENT_KEYS = [...new Set(SegmentUnion.options.flatMap((o) => Object.keys(o.shape)))];
const LAYER_KEYS = Object.keys(DeclaredLayer.shape);
const LAYER_SOURCE_KEYS = Object.keys(DeclaredLayerSourceBase.shape);

/**
 * Which valid keys to compare a typo against, and how to name the place it appeared. Derived from
 * the schemas themselves, so a new field is suggestible the moment it exists.
 */
function locate(path: (string | number)[]): { where: string; candidates: string[] } {
  const [head, index, ...rest] = path;
  if (head === "segments" && rest.length === 0 && index !== undefined) {
    return { where: `segments[${index}]`, candidates: SEGMENT_KEYS };
  }
  if (head === "layers" && index !== undefined) {
    // `layers[0]` itself, or the `source` object nested in it — the only two closed objects there.
    const where = `layers[${index}]${rest.length ? `.${rest.join(".")}` : ""}`;
    if (rest.length === 0) return { where, candidates: LAYER_KEYS };
    if (rest.length === 1 && rest[0] === "source") return { where, candidates: LAYER_SOURCE_KEYS };
    return { where, candidates: [] };
  }
  if (path.length === 0) return { where: "spec", candidates: SPEC_KEYS };
  return { where: path.join("."), candidates: [] };
}

function formatUnrecognizedKey(key: string, path: (string | number)[]): string {
  const onSegment = path[0] === "segments";
  const { where, candidates } = locate(path);
  if (onSegment && TOP_LEVEL_KEYS[key]) return `${where}: ${TOP_LEVEL_KEYS[key]}`;
  if (onSegment && SEGMENT_KIND_HINTS[key]) return `${where}: ${SEGMENT_KIND_HINTS[key]}`;
  return `${where}: unrecognized key '${key}'${suggestKey(key, candidates)}`;
}

/** Humanize Zod unrecognized_keys (and keep other issues). Prefer this at CLI boundaries. */
export function formatSpecError(err: z.ZodError): string {
  return err.issues
    .map((issue) => {
      if (issue.code === "unrecognized_keys") {
        return issue.keys.map((k) => formatUnrecognizedKey(k, issue.path)).join("\n");
      }
      const loc = issue.path.length ? `${issue.path.join(".")}: ` : "";
      return `${loc}${issue.message}`;
    })
    .join("\n");
}
/** Parse a spec with helpful footgun messages (film on a segment, transition on motion, …). */
export function parseSpec(input: unknown): Spec {
  const r = SpecSchema.safeParse(input);
  if (!r.success) throw new Error(formatSpecError(r.error));
  const imgErrs = validateSegmentImages(r.data);
  if (imgErrs.length) throw new Error(imgErrs.join("\n"));
  return resolveSpec(r.data);
}

/** Load and parse a spec JSON file from disk. */
export function loadSpec(path: string): Spec {
  const raw = readFileSync(path, "utf8");
  try {
    return parseSpec(JSON.parse(raw));
  } catch (e) {
    if (e instanceof SyntaxError) throw new Error(`Invalid JSON in spec file (${path}): ${e.message}`);
    throw e;
  }
}
