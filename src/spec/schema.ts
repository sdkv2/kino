import { z } from "zod";

const Kicker = z.object({ text: z.string(), color: z.enum(["mint", "green", "gold"]).default("mint") });
const Shot = z.enum(["push-in", "pull-out", "pan-left", "pan-right", "tilt-up", "static"]);
const Transition = z.enum(["fade", "fly-left", "fly-up", "pop", "cut"]);
const Provider = z.enum(["none", "heygen", "hedra", "replicate"]);

const Segment = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("avatar"),
    text: z.string().min(1),
    caption: z.string().min(1),
    cta: z.boolean().default(false),
    shot: Shot.optional(),
  }),
  z.object({
    kind: z.literal("app"),
    asset: z.string().min(1),
    text: z.string().min(1),
    caption: z.string().min(1),
    kicker: Kicker.optional(),
    shot: Shot.optional(),
    transition: Transition.optional(),
  }),
]);

export const SpecSchema = z.object({
  brand: z.string(),
  title: z.string().regex(/^[a-z0-9-]+$/, "title must be kebab-case"),
  format: z.array(z.enum(["9:16", "3:4"])).default(["9:16"]),
  voice: z.string().optional(),
  avatarLook: z.string().optional(), // heygen: look alias/id · hedra/replicate: portrait image path/url
  provider: Provider.optional(), // overrides brand.defaultProvider
  segments: z.array(Segment).min(1),
});

export type Spec = z.infer<typeof SpecSchema>;
export type Segment = z.infer<typeof Segment>;
