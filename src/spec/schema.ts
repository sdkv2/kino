import { z } from "zod";

const Kicker = z.object({ text: z.string(), color: z.enum(["mint", "green", "gold"]).default("mint") });
const Shot = z.enum(["push-in", "pull-out", "pan-left", "pan-right", "tilt-up", "static"]);
const Transition = z.enum(["fade", "fly-left", "fly-up", "pop", "cut"]);
const Provider = z.enum(["none", "heygen", "hedra", "replicate"]);
const Background = z.enum(["glow", "image", "mesh", "aurora", "particles", "grid", "custom"]);
const CaptionMode = z.enum(["phrase", "words"]);

const Segment = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("avatar"),
    text: z.string().min(1),
    caption: z.string().min(1),
    cta: z.boolean().default(false),
    shot: Shot.optional(),
    captionMode: CaptionMode.optional(),
    emphasis: z.array(z.string()).optional(),
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
  segments: z.array(Segment).min(1),
});

export type Spec = z.infer<typeof SpecSchema>;
export type Segment = z.infer<typeof Segment>;
