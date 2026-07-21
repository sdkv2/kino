import { z } from "zod";
import { readFileSync } from "node:fs";

// project.json — optionally assigns a brand to a project and sets default overrides for it.
// No brand → kino house defaults (DEFAULT_BRAND).
export const ProjectConfigSchema = z.object({
  brand: z.string().optional(),
  provider: z.enum(["none", "heygen", "hedra", "replicate"]).optional(),
  background: z.enum(["glow", "image", "mesh", "aurora", "particles", "grid", "custom"]).optional(),
  font: z.string().optional(),
  captionMode: z.enum(["phrase", "words"]).optional(),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

export function loadProjectConfig(path: string): ProjectConfig {
  return ProjectConfigSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}
