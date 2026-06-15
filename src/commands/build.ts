import { readFileSync, mkdirSync, mkdtempSync, copyFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, isAbsolute } from "node:path";
import { resolveProject, type Project } from "../config/project.js";
import { loadEnv, requireKey } from "../config/env.js";
import { loadBrand, type Brand } from "../config/brand.js";
import { SpecSchema, type Spec } from "../spec/schema.js";
import { validateSpec, resolveProvider, resolveVoice, resolveVoiceLook } from "../spec/validate.js";
import { needsSourceImage, type Provider } from "../avatar/provider.js";
import { Cache } from "../media/cache.js";
import { contentHash } from "../media/hash.js";
import { buildVO, GAP } from "../vo/vo.js";
import { buildAvatar } from "../avatar/avatar.js";
import { planAvatarWindows } from "../avatar/plan.js";
import { stitchAudio } from "../media/ffmpeg.js";
import { renderVideo } from "../render/render.js";
import type { KinoProps } from "../render/props.js";
import { pickShot, pickTransition, type Shot, type Transition } from "../render/motion.js";
import { log } from "../log.js";

const KICKER_FG: Record<string, string> = { mint: "#06210f", green: "#ffffff", gold: "#0b1020" };

// Resolve the portrait image hedra/replicate lip-sync against (heygen uses a hosted look id instead).
function resolveSourceImage(spec: Spec, brand: Brand, project: Project, provider: Provider): string {
  const img = spec.avatarLook ?? brand.avatarImage;
  if (!img) {
    throw new Error(`Provider "${provider}" needs a portrait image — set brand.avatarImage (or spec.avatarLook) to an image path.`);
  }
  const abs = isAbsolute(img) ? img : join(project.root, img);
  if (!existsSync(abs)) throw new Error(`Avatar image not found: ${abs}`);
  return abs;
}

// Resolve an optional brand asset (logo/backdrop) to an absolute path under the project root.
function resolveBrandFile(p: string | undefined, project: Project): string | null {
  if (!p) return null;
  const abs = isAbsolute(p) ? p : join(project.root, p);
  if (!existsSync(abs)) throw new Error(`Brand asset not found: ${abs}`);
  return abs;
}

// Stitch only the on-camera clips into the trimmed avatar track (cached so edits don't re-stitch).
async function stitchAvatarTrack(clips: string[], indices: number[], cache: Cache): Promise<string> {
  const avClips = indices.map((i) => clips[i]);
  const key = contentHash({ avClips, GAP, kind: "avtrack" });
  const cached = cache.get(key, "mp3");
  if (cached) return cached;
  const tmp = join(mkdtempSync(join(tmpdir(), "kino-avtrk-")), "avtrack.mp3");
  await stitchAudio(avClips, GAP, tmp);
  return cache.put(key, "mp3", tmp);
}

export async function build(specPath: string, opts: { mock?: boolean; format?: string; provider?: string }): Promise<string[]> {
  const project = resolveProject();
  loadEnv(project.root);
  const spec = SpecSchema.parse(JSON.parse(readFileSync(specPath, "utf8")));
  const brand = loadBrand(project.brandDir(spec.brand));
  validateSpec(spec, brand, project);
  const provider = (opts.provider as Provider | undefined) ?? resolveProvider(spec, brand);
  const voiceId = resolveVoice(spec, brand);
  const formats = (opts.format ? opts.format.split(",") : spec.format) as Array<"9:16" | "3:4">;
  const cache = new Cache(project.cache);
  const mock = !!opts.mock;

  log.info(`Building ${spec.title} · ${provider}${mock ? " · MOCK — no API spend" : ""}`);

  log.step("voiceover");
  const vo = await buildVO({
    spec,
    voiceId,
    cache,
    apiKey: mock ? undefined : requireKey("ELEVENLABS_API_KEY"),
    mock,
  });

  log.step("avatar");
  const plan = planAvatarWindows(spec.segments.map((s) => s.kind), vo.timings, GAP);
  const avatarWindows = plan.windows; // contiguous on-camera runs: avatar placement + steady faceless logo
  let avatarRel: string | null = null;
  let avatarPath: string | null = null;
  if (provider === "none" || plan.avatarIndices.length === 0) {
    log.info("  · faceless (no avatar generated)");
  } else {
    const avTrack = await stitchAvatarTrack(vo.clips, plan.avatarIndices, cache);
    const source = provider === "heygen" ? resolveVoiceLook(spec, brand).lookId : resolveSourceImage(spec, brand, project, provider);
    avatarPath = await buildAvatar({ provider, audioPath: avTrack, source, brand, cache, mock });
    avatarRel = "avatar.mp4";
    log.info(`  · ${plan.avatarIndices.length}/${spec.segments.length} segments on camera (trimmed)`);
  }

  // Stage everything Remotion reads via staticFile(): app assets, the avatar clip, and the VO track.
  const publicDir = join(project.outDir(spec.title), "_public");
  mkdirSync(publicDir, { recursive: true });
  for (const seg of spec.segments) {
    if (seg.kind === "app") {
      const dest = join(publicDir, seg.asset);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(project.assetPath(seg.asset), dest);
    }
  }
  if (avatarRel && avatarPath) copyFileSync(avatarPath, join(publicDir, avatarRel));
  copyFileSync(vo.trackPath, join(publicDir, "vo.mp3"));
  const logoAbs = resolveBrandFile(brand.logo, project);
  if (logoAbs) copyFileSync(logoAbs, join(publicDir, "logo.png"));
  const bgAbs = resolveBrandFile(brand.facelessBackdrop, project);
  if (bgAbs) copyFileSync(bgAbs, join(publicDir, "faceless-bg.png"));

  const c = brand.colors;
  // Resolve a camera shot + transition per app cut-in (auto-vary, spec can override).
  let appIdx = 0;
  const renderSegments = spec.segments.map((seg, i) => {
    const base = {
      kind: seg.kind,
      asset: seg.kind === "app" ? seg.asset : undefined,
      caption: seg.caption,
      startSec: vo.timings[i].startSec,
      endSec: vo.timings[i].endSec,
    };
    if (seg.kind === "app") {
      const shot = pickShot(appIdx, seg.shot as Shot | undefined);
      const transition = pickTransition(appIdx, seg.transition as Transition | undefined);
      appIdx++;
      return {
        ...base,
        shot,
        transition,
        kicker: seg.kicker
          ? { text: seg.kicker.text, color: c[seg.kicker.color], fg: KICKER_FG[seg.kicker.color] }
          : undefined,
      };
    }
    return { ...base, shot: seg.shot as Shot | undefined };
  });

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
    avatarWindows,
    voTrack: "vo.mp3",
    logo: logoAbs ? "logo.png" : null,
    facelessBg: bgAbs ? "faceless-bg.png" : null,
    disclosure: avatarRel ? brand.disclosure : (brand.facelessDisclosure ?? brand.disclosure),
    segments: renderSegments,
  };

  log.step("render");
  const outs = await renderVideo({ props, publicDir, formats, outDir: project.outDir(spec.title), title: spec.title });
  outs.forEach((o) => log.ok(o));
  return outs;
}
