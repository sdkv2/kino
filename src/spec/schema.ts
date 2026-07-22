// THE SPEC CONTRACT. Zod schema for the agent-authored spec.json that drives a build: title,
// format, segments (avatar/app/motion), captions, background, overlays, keyframes. This is the
// single source of truth for what an agent may author; keep it and docs/spec-reference.md in sync.
// Exports the Spec type used throughout the pipeline. Note: keyframe/trigger `at` is in seconds
// (resolved against frame/fps in the render layer).
import { z } from "zod";
import { CAPTION_STYLES, CAPTION_ANIMATIONS, CAPTION_REVEALS } from "../render/textStyles.js";

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
});

const Kicker = z.object({ text: z.string(), color: z.enum(["mint", "green", "gold"]).default("mint") });
const Shot = z.enum(["push-in", "pull-out", "pan-left", "pan-right", "tilt-up", "scroll", "scroll-up", "static"]);
const Transition = z.enum(["fade", "dissolve", "fly-left", "fly-up", "pop", "cut"]);
const Provider = z.enum(["none", "heygen", "hedra", "replicate"]);
const Background = z.enum(["glow", "image", "mesh", "aurora", "particles", "grid", "solid", "custom"]);
const CaptionMode = z.enum(["phrase", "words"]);
const BgKeyframe = z.object({
  at: z.number(),
  params: z.record(z.union([z.number(), z.string()])),
  ease: z.enum(["linear", "easeInOut", "overshoot", "spring"]).optional(),
});
const BgTrigger = z.object({ at: z.number(), action: z.string() });
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
    ease: z.enum(["linear", "easeInOut", "overshoot", "spring"]).optional(),
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
const LogoSize = z.union([z.enum(["small", "medium", "big"]), z.number()]);
const LogoPosition = z.union([z.enum(["top", "bottom", "left", "right", "center"]), z.object({ x: z.number(), y: z.number() })]);

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
  })
  .strict();

const Segment = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("avatar"),
    text: z.string().min(1),
    caption: z.string().optional(), // omit → no on-screen line for this beat (VO still speaks `text`)
    cta: z.boolean().default(false),
    shot: Shot.optional(),
    captionMode: CaptionMode.optional(),
    emphasis: z.array(z.string()).optional(),
    captionKeyframes: z.array(BgKeyframe).optional(),
    motionOverlay: MotionGraphicRef.optional(),
    captionStyle: CaptionStyle.optional(),
    captionAnimation: CaptionAnimation.optional(),
    captionReveal: CaptionReveal.optional(),
    texts: z.array(TextOverlaySpec).optional(),
  })
  .strict(),
  z.object({
    kind: z.literal("app"),
    asset: z.string().min(1),
    text: z.string().min(1),
    caption: z.string().optional(), // omit → no on-screen line for this beat (VO still speaks `text`)
    kicker: Kicker.optional(),
    shot: Shot.optional(),
    transition: Transition.optional(),
    // Source-footage slice + retiming (importing-footage skill). Seconds into the asset.
    clipFrom: z.number().min(0).optional(),
    clipTo: z.number().min(0).optional(),
    speed: z.number().positive().default(1), // OffthreadVideo playbackRate; tune after beats exist
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
    captionMode: CaptionMode.optional(),
    emphasis: z.array(z.string()).optional(),
    captionKeyframes: z.array(BgKeyframe).optional(),
    kickerKeyframes: z.array(BgKeyframe).optional(),
    // Camera push/pan on the whole footage+chrome group (the "canvas zoom" for inset device footage).
    // Beat-relative track — `at` is seconds from THIS segment's start (like captionKeyframes), so it
    // rides the beat when VO timing shifts; params x/y/scale/opacity.
    zoomKeyframes: z.array(BgKeyframe).optional(),
    motionOverlay: MotionGraphicRef.optional(),
    captionStyle: CaptionStyle.optional(),
    captionAnimation: CaptionAnimation.optional(),
    captionReveal: CaptionReveal.optional(),
    texts: z.array(TextOverlaySpec).optional(),
  })
  .strict(),
  z.object({
    kind: z.literal("motion"),
    ...motionFields,
    text: z.string().min(1),
    caption: z.string().optional(),
    cta: z.boolean().default(false), // semantic end-card marker; a full-screen wordmark motion beat is itself the CTA

    captionMode: CaptionMode.optional(),
    emphasis: z.array(z.string()).optional(),
    captionKeyframes: z.array(BgKeyframe).optional(),
    captionStyle: CaptionStyle.optional(),
    captionAnimation: CaptionAnimation.optional(),
    captionReveal: CaptionReveal.optional(),
    texts: z.array(TextOverlaySpec).optional(),
  })
  .strict(),
]);

export const SpecSchema = z
  .object({
    brand: z.string().optional(), // falls back to the project's project.json brand
    title: z.string().regex(/^[a-z0-9-]+$/, "title must be kebab-case"),
    kinoVersion: z.string().optional(), // kino version this spec was authored/built against — mismatch warns, doesn't fail
    format: z.array(z.enum(["9:16", "3:4"])).default(["9:16"]),
    voice: z.string().optional(),
    // TTS model. Default eleven_v3 (audio tags like [excited] work). Opt into
    // eleven_multilingual_v2 for metronome-critical / timing-stable reads.
    voiceModel: z.string().optional(),
    // Cinematic-finish intensity (vignette + grain over photographic/app beats), 0..1. Default 1
    // (graded film look). Set 0 for a clean, flat video — e.g. a light "paper" brand where the edge
    // vignette reads as a dark border. Motion-graphic beats are never graded (they own their finish).
    film: z.number().min(0).max(1).optional(),
    avatarLook: z.string().optional(), // heygen: look alias/id · hedra/replicate: portrait image path/url
    provider: Provider.optional(), // overrides brand.defaultProvider
    background: Background.optional(), // overrides brand.background (faceless beats)
    backgroundIntensity: z.number().min(0).max(1).optional(), // 0..1 motion strength override
    backgroundKeyframes: z.array(BgKeyframe).optional(), // agent-driven param tweens over time
    backgroundTriggers: z.array(BgTrigger).optional(), // agent-driven one-shot actions (e.g. pulse)
    logoSize: LogoSize.optional(), // small|medium|big or px (overrides brand.logoSize)
    logoPosition: LogoPosition.optional(), // top|bottom|left|right|center or {x,y}% (overrides brand)
    logoKeyframes: z.array(BgKeyframe).optional(), // tween logo x/y/scale/opacity over time
    // Custom Canvas2D draw fn when background is "custom". Bare id → assets-lib/backgrounds/;
    // path → project assets/ or workspace (overrides brand.backgroundComponent).
    backgroundComponent: z.string().min(1).optional(),
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
    segments: z.array(Segment).min(1),
  })
  .strict() // reject unknown top-level keys — a misplaced/misspelled key errors instead of silently no-op'ing
  .superRefine((spec, ctx) => {
    // Kept off the app object so discriminatedUnion stays a plain ZodObject (ZodEffects breaks it).
    spec.segments.forEach((seg, i) => {
      if (seg.kind !== "app") return;
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
  logoPosition: "logoPosition is top-level (or brand.json) — not a segment field",
  logoSize: "logoSize is top-level (or brand.json) — not a segment field",
  logoKeyframes: "logoKeyframes is top-level — not a segment field",
  film: "film is top-level — not a segment field",
  seamlessLoop: "seamlessLoop is top-level — not a segment field",
  background: "background is top-level (or brand.json) — not a segment field",
  backgroundIntensity: "backgroundIntensity is top-level — not a segment field",
  backgroundKeyframes: "backgroundKeyframes is top-level — not a segment field",
  backgroundTriggers: "backgroundTriggers is top-level — not a segment field",
  music: "music is top-level — not a segment field",
  sfx: "sfx is top-level — not a segment field",
  voice: "voice is top-level (or brand.json) — not a segment field",
  voiceModel: "voiceModel is top-level — not a segment field",
  provider: "provider is top-level (or brand/project) — not a segment field",
  avatarLook: "avatarLook is top-level (or brand.json) — not a segment field",
};

/** Keys valid on some segment kinds but rejected on others (strict). */
const SEGMENT_KIND_HINTS: Record<string, string> = {
  transition: "transition is app-only (motion hard-cuts; motion→motion auto-dissolves)",
  asset: "asset is app-only",
  clipFrom: "clipFrom/clipTo are app-only (importing-footage)",
  clipTo: "clipFrom/clipTo are app-only (importing-footage)",
  speed: "speed is app-only",
  pauseAt: "pauseAt is app-only",
  frame: "frame chrome is app-only",
  kicker: "kicker is app-only",
  zoomKeyframes: "zoomKeyframes is app-only",
  kickerKeyframes: "kickerKeyframes is app-only",
  source: "source is motion-only (or motionOverlay on avatar/app)",
  triggers: "triggers are motion-only (or motionOverlay / top-level backgroundTriggers)",
  keyframes: "keyframes are motion-only (or motionOverlay)",
  params: "params are motion-only (or motionOverlay)",
  loop: "loop is motion/Lottie-only",
  cta: "cta is avatar/motion-only",
  motionOverlay: "motionOverlay is avatar/app-only (motion segments use source)",
};

function formatUnrecognizedKey(key: string, path: (string | number)[]): string {
  const onSegment = path[0] === "segments";
  const where = onSegment ? `segments[${path[1]}]` : path.length ? path.join(".") : "spec";
  if (onSegment && TOP_LEVEL_KEYS[key]) return `${where}: ${TOP_LEVEL_KEYS[key]}`;
  if (onSegment && SEGMENT_KIND_HINTS[key]) return `${where}: ${SEGMENT_KIND_HINTS[key]}`;
  return `${where}: unrecognized key '${key}'`;
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

/** Parse a spec with helpful footgun messages (logoPosition on CTA, transition on motion, …). */
export function parseSpec(input: unknown): Spec {
  const r = SpecSchema.safeParse(input);
  if (r.success) return r.data;
  throw new Error(formatSpecError(r.error));
}
