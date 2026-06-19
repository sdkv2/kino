// THE SPEC CONTRACT. Zod schema for the agent-authored spec.json that drives a build: title,
// format, segments (avatar/app/motion), captions, background, overlays, keyframes. This is the
// single source of truth for what an agent may author; keep it and docs/spec-reference.md in sync.
// Exports the Spec type used throughout the pipeline. Note: keyframe/trigger `at` is in seconds
// (resolved against frame/fps in the render layer).
import { z } from "zod";

const Kicker = z.object({ text: z.string(), color: z.enum(["mint", "green", "gold"]).default("mint") });
const Shot = z.enum(["push-in", "pull-out", "pan-left", "pan-right", "tilt-up", "scroll", "scroll-up", "static"]);
const Transition = z.enum(["fade", "fly-left", "fly-up", "pop", "cut"]);
const Provider = z.enum(["none", "heygen", "hedra", "replicate"]);
const Background = z.enum(["glow", "image", "mesh", "aurora", "particles", "grid", "custom"]);
const CaptionMode = z.enum(["phrase", "words"]);
const BgKeyframe = z.object({
  at: z.number(),
  params: z.record(z.union([z.number(), z.string()])),
  ease: z.enum(["linear", "easeInOut", "overshoot", "spring"]).optional(),
});
const BgTrigger = z.object({ at: z.number(), action: z.string() });
const motionFields = {
  source: z.string().min(1),
  params: z.record(z.union([z.number(), z.string()])).optional(),
  keyframes: z.array(BgKeyframe).optional(),
  triggers: z.array(BgTrigger).optional(),
  loop: z.boolean().optional(), // Tier-3 Lottie playback; inert for html/proc graphics
};
const MotionGraphicRef = z.object(motionFields);
const LogoSize = z.union([z.enum(["small", "medium", "big"]), z.number()]);
const LogoPosition = z.union([z.enum(["top", "bottom", "left", "right", "center"]), z.object({ x: z.number(), y: z.number() })]);

const Segment = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("avatar"),
    text: z.string().min(1),
    caption: z.string().min(1),
    cta: z.boolean().default(false),
    shot: Shot.optional(),
    captionMode: CaptionMode.optional(),
    emphasis: z.array(z.string()).optional(),
    captionKeyframes: z.array(BgKeyframe).optional(),
    motionOverlay: MotionGraphicRef.optional(),
  }),
  z.object({
    kind: z.literal("app"),
    asset: z.string().min(1),
    text: z.string().min(1),
    caption: z.string().min(1),
    kicker: Kicker.optional(),
    shot: Shot.optional(),
    transition: Transition.optional(),
    captionMode: CaptionMode.optional(),
    emphasis: z.array(z.string()).optional(),
    captionKeyframes: z.array(BgKeyframe).optional(),
    kickerKeyframes: z.array(BgKeyframe).optional(),
    motionOverlay: MotionGraphicRef.optional(),
  }),
  z.object({
    kind: z.literal("motion"),
    ...motionFields,
    text: z.string().min(1),
    caption: z.string().optional(),
    captionMode: CaptionMode.optional(),
    emphasis: z.array(z.string()).optional(),
    captionKeyframes: z.array(BgKeyframe).optional(),
  }),
]);

export const SpecSchema = z.object({
  brand: z.string().optional(), // falls back to the project's project.json brand
  title: z.string().regex(/^[a-z0-9-]+$/, "title must be kebab-case"),
  format: z.array(z.enum(["9:16", "3:4"])).default(["9:16"]),
  voice: z.string().optional(),
  avatarLook: z.string().optional(), // heygen: look alias/id · hedra/replicate: portrait image path/url
  provider: Provider.optional(), // overrides brand.defaultProvider
  background: Background.optional(), // overrides brand.background (faceless beats)
  backgroundIntensity: z.number().optional(), // 0..1 motion strength override
  backgroundKeyframes: z.array(BgKeyframe).optional(), // agent-driven param tweens over time
  backgroundTriggers: z.array(BgTrigger).optional(), // agent-driven one-shot actions (e.g. pulse)
  logoSize: LogoSize.optional(), // small|medium|big or px (overrides brand.logoSize)
  logoPosition: LogoPosition.optional(), // top|bottom|left|right|center or {x,y}% (overrides brand)
  logoKeyframes: z.array(BgKeyframe).optional(), // tween logo x/y/scale/opacity over time
  segments: z.array(Segment).min(1),
});

export type Spec = z.infer<typeof SpecSchema>;
export type Segment = z.infer<typeof Segment>;
