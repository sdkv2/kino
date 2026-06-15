import { z } from "zod";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const BrandSchema = z.object({
  name: z.string(),
  colors: z.object({
    night: z.string(),
    mint: z.string(),
    green: z.string(),
    white: z.string().default("#ffffff"),
    gold: z.string().default("#d99a20"),
  }),
  font: z.string().default('Helvetica, "Helvetica Neue", Arial, sans-serif'),
  captionStyle: z
    .object({
      fontSize: z.number().default(74),
      strokeWidth: z.number().default(9),
    })
    .default({}),
  disclosure: z.string(), // shown when an avatar is present
  facelessDisclosure: z.string().optional(), // shown when no avatar renders (falls back to disclosure)
  logo: z.string().optional(), // brand mark (transparent PNG) shown on faceless talking beats
  facelessBackdrop: z.string().optional(), // background image for faceless beats (else CSS glow)
  bannedPhrases: z.array(z.string()).default([]),
  defaultVoice: z.string().optional(),
  defaultLook: z.string().optional(),
  defaultProvider: z.enum(["none", "heygen", "hedra", "replicate"]).optional(),
  avatarImage: z.string().optional(), // portrait used as the source for hedra/replicate
  hedraModelId: z.string().optional(), // Character-3 model id (else auto-pick first from /models)
  replicateModel: z.string().optional(), // owner/name[:version] of the lip-sync model (default cjwbw/sadtalker)
  replicateImageField: z.string().optional(), // input key for the portrait (default source_image)
  replicateAudioField: z.string().optional(), // input key for the audio (default driven_audio)
  replicateInput: z.record(z.unknown()).optional(), // extra model inputs
  voiceAliases: z.record(z.string()).default({}),
  lookAliases: z.record(z.string()).default({}),
});

export type Brand = z.infer<typeof BrandSchema>;

export function loadBrand(brandDir: string): Brand {
  const raw = JSON.parse(readFileSync(join(brandDir, "brand.json"), "utf8"));
  return BrandSchema.parse(raw);
}
