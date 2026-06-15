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
  disclosure: z.string(),
  bannedPhrases: z.array(z.string()).default([]),
  defaultVoice: z.string().optional(),
  defaultLook: z.string().optional(),
  voiceAliases: z.record(z.string()).default({}),
  lookAliases: z.record(z.string()).default({}),
});

export type Brand = z.infer<typeof BrandSchema>;

export function loadBrand(brandDir: string): Brand {
  const raw = JSON.parse(readFileSync(join(brandDir, "brand.json"), "utf8"));
  return BrandSchema.parse(raw);
}
