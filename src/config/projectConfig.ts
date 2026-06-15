import { z } from "zod";
import { readFileSync } from "node:fs";

// project.json — assigns a brand to a project and optionally sets default overrides for it.
export const ProjectConfigSchema = z.object({
  brand: z.string(),
  provider: z.enum(["none", "heygen", "hedra", "replicate"]).optional(),
  background: z.enum(["glow", "image", "mesh", "aurora", "particles", "grid", "custom"]).optional(),
  font: z.string().optional(),
  captionMode: z.enum(["phrase", "words"]).optional(),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

export function loadProjectConfig(path: string): ProjectConfig {
  return ProjectConfigSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}
