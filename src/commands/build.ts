import { readFileSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveProject } from "../config/project.js";
import { loadEnv, requireKey } from "../config/env.js";
import { loadBrand } from "../config/brand.js";
import { SpecSchema } from "../spec/schema.js";
import { validateSpec, resolveVoiceLook } from "../spec/validate.js";
import { Cache } from "../media/cache.js";
import { buildVO } from "../vo/vo.js";
import { buildAvatar } from "../avatar/avatar.js";
import { renderVideo } from "../render/render.js";
import type { KinoProps } from "../render/props.js";
import { log } from "../log.js";

const KICKER_FG: Record<string, string> = { mint: "#06210f", green: "#ffffff", gold: "#0b1020" };

export async function build(specPath: string, opts: { mock?: boolean; format?: string }): Promise<string[]> {
  const project = resolveProject();
  loadEnv(project.root);
  const spec = SpecSchema.parse(JSON.parse(readFileSync(specPath, "utf8")));
  const brand = loadBrand(project.brandDir(spec.brand));
  validateSpec(spec, brand, project);
  const { voiceId, lookId } = resolveVoiceLook(spec, brand);
  const formats = (opts.format ? opts.format.split(",") : spec.format) as Array<"9:16" | "3:4">;
  const cache = new Cache(project.cache);
  const mock = !!opts.mock;

  log.info(`Building ${spec.title} (${mock ? "MOCK — no API spend" : "live"})`);

  log.step("voiceover");
  const vo = await buildVO({
    spec,
    voiceId,
    cache,
    apiKey: mock ? undefined : requireKey("ELEVENLABS_API_KEY"),
    mock,
  });

  log.step("avatar");
  const hasAvatar = spec.segments.some((s) => s.kind === "avatar");
  const avatarPath = hasAvatar ? await buildAvatar({ voPath: vo.trackPath, lookId, cache, mock }) : null;

  // Stage assets Remotion reads via staticFile(): app assets (preserving rel paths) + avatar.
  const publicDir = join(project.outDir(spec.title), "_public");
  mkdirSync(publicDir, { recursive: true });
  for (const seg of spec.segments) {
    if (seg.kind === "app") {
      const dest = join(publicDir, seg.asset);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(project.assetPath(seg.asset), dest);
    }
  }
  let avatarRel: string | null = null;
  if (avatarPath) {
    avatarRel = "avatar.mp4";
    copyFileSync(avatarPath, join(publicDir, avatarRel));
  }

  const c = brand.colors;
  const props: KinoProps = {
    theme: {
      font: brand.font,
      night: c.night,
      mint: c.mint,
      green: c.green,
      gold: c.gold,
      white: c.white,
      captionFontSize: brand.captionStyle.fontSize,
      captionStroke: brand.captionStyle.strokeWidth,
    },
    fps: 30,
    avatar: avatarRel,
    disclosure: brand.disclosure,
    segments: spec.segments.map((seg, i) => ({
      kind: seg.kind,
      asset: seg.kind === "app" ? seg.asset : undefined,
      caption: seg.caption,
      startSec: vo.timings[i].startSec,
      endSec: vo.timings[i].endSec,
      kicker:
        seg.kind === "app" && seg.kicker
          ? { text: seg.kicker.text, color: c[seg.kicker.color], fg: KICKER_FG[seg.kicker.color] }
          : undefined,
    })),
  };

  log.step("render");
  const outs = await renderVideo({ props, publicDir, formats, outDir: project.outDir(spec.title), title: spec.title });
  outs.forEach((o) => log.ok(o));
  return outs;
}
