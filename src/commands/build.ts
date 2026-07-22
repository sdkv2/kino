// Pipeline backbone: spec → VO → avatar plan/trim → faceless background → fonts → frame render.
// prepare() is the shared resolver that does everything up to (but not including) the final encode;
// the preview commands (still/storyboard/inspect) reuse it so they resolve through the exact same
// code path as a real build (note: they default to mock VO). build() adds only the render +
// variant-tagging on top.
import { readFileSync, readdirSync, mkdirSync, mkdtempSync, copyFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, isAbsolute } from "node:path";
import { resolveProject, type Project } from "../config/project.js";
import { loadProjectConfig } from "../config/projectConfig.js";
import { loadEnv, requireKey } from "../config/env.js";
import { loadBrand, DEFAULT_BRAND, type Brand } from "../config/brand.js";
import { parseSpec, type Format, type Spec } from "../spec/schema.js";
import { validateSpec, assertLandscapeSupport, resolveProvider, resolveVoice, resolveVoiceLook, resolveVoiceModel, resolveFilm } from "../spec/validate.js";
import { needsSourceImage, type Provider } from "../avatar/provider.js";
import { Cache } from "../media/cache.js";
import { contentHash } from "../media/hash.js";
import { buildVO, GAP } from "../vo/vo.js";
import { buildAvatar } from "../avatar/avatar.js";
import { planAvatarWindows } from "../avatar/plan.js";
import { resolveBackgroundKind, resolveBackgroundColors, resolveBackgroundIntensity } from "../render/background.js";
import { lookupFont } from "../fonts/registry.js";
import { ensureFont } from "../fonts/manager.js";
import { resolveLogoSize, resolveLogoPosition, resolveCaptionBackplate } from "../render/elements.js";
import { probeDuration, stitchAudio } from "../media/ffmpeg.js";
import { resolveAudioSource } from "../media/sfx.js";
import { resolveBackgroundComponent } from "../media/backgroundLib.js";
import { renderVideo, renderStills, variantName } from "../render/render.js";
import type { KinoProps, KinoSegment, MotionGraphicProps, Theme, WordTiming } from "../render/props.js";
import { resolveCaptionLook, resolveTexts } from "../render/textStyles.js";
import { pickShot, pickTransition, type Shot, type Transition } from "../render/motion.js";
import { resolveMotionGraphic, lintMotionHtml, type MotionGraphicRefInput } from "../render/motiongraphic.js";
import { sanitizeMotionHtml } from "../render/sanitizeMotion.js";
import { extractSceneRefs, svgAspect } from "../render/scene.js";
import { screenDigest, layerDigest, rasterizeScreen, rasterizeLayer } from "../render/scene/rasterize.js";
import { beatRelativeWords, resolveWordAnchors } from "../render/motionVars.js";
import { probeFramePicks, isUnderAnimated } from "../render/motionProbe.js";
import { checkLoopSeam, imageMeanDiff } from "../media/loopSeam.js";
import { holdLastFrameToMatchAudio } from "../media/avSync.js";
import { runScene } from "../render/scene/runScene.js";
import { ensureSceneStills } from "../render/scene/ensureStills.js";
import { DIMS } from "../render/dims.js";
import { log } from "../log.js";

// Resolve the portrait image hedra/replicate lip-sync against (heygen uses a hosted look id instead).
function resolveSourceImage(spec: Spec, brand: Brand, project: Project, provider: Provider): string {
  // avatarLook is a hosted look id for heygen; for hedra/replicate it's a portrait path. Only use it
  // here if it's actually path-like, else fall back to brand.avatarImage (so a heygen look id like
  // "lucas" doesn't get mistaken for an image when switching providers).
  const pathLike = (s: string) => /[\\/]/.test(s) || /\.(png|jpe?g|webp)$/i.test(s);
  const img = spec.avatarLook && pathLike(spec.avatarLook) ? spec.avatarLook : brand.avatarImage;
  if (!img) {
    throw new Error(`Provider "${provider}" needs a portrait image — set brand.avatarImage (or spec.avatarLook) to an image path.`);
  }
  const abs = isAbsolute(img) ? img : join(project.workspaceRoot, img);
  if (!existsSync(abs)) throw new Error(`Avatar image not found: ${abs}`);
  return abs;
}

// Resolve an optional brand asset (logo/backdrop) — brands are shared, so paths are workspace-relative.
function resolveBrandFile(p: string | undefined, project: Project): string | null {
  if (!p) return null;
  const abs = isAbsolute(p) ? p : join(project.workspaceRoot, p);
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

export interface PrepareResult {
  props: KinoProps;
  publicDir: string;
  scene3dDir: string; // Blender-rendered 3D scene stills cache, beside publicDir (cross-build — never wiped)
  formats: Format[];
  project: Project;
  spec: Spec;
  labelFont: string | null; // absolute TTF path for storyboard/montage labels, if resolved
  words: WordTiming[][]; // per-segment word timings, absolute on the main timeline
}

// Everything build does up to (but not including) the final video render. Reused by the
// inspection commands (still/storyboard/inspect) so they share the exact pipeline.
export async function prepare(
  specPath: string,
  opts: {
    mock?: boolean;
    format?: string;
    provider?: string;
    background?: string;
    font?: string;
    project?: string;
    draft3d?: boolean; // force quality "draft" for every 3D scene beat (kino build --draft / preview default)
  },
): Promise<PrepareResult> {
  const project = resolveProject({ specPath, project: opts.project });
  loadEnv(project.workspaceRoot);
  const spec = parseSpec(JSON.parse(readFileSync(specPath, "utf8")));

  // A project.json assigns a brand + optional default overrides (layered under spec/CLI).
  const pc = loadProjectConfig(project.projectConfigPath);
  const brandName = spec.brand ?? pc?.brand;
  const rawBrand = brandName ? loadBrand(project.brandDir(brandName)) : DEFAULT_BRAND;
  const brand: Brand = {
    ...rawBrand,
    defaultProvider: pc?.provider ?? rawBrand.defaultProvider,
    background: pc?.background ?? rawBrand.background,
    font: pc?.font ?? rawBrand.font,
    captionMode: pc?.captionMode ?? rawBrand.captionMode,
  };
  validateSpec(spec, brand, project);
  const provider = (opts.provider as Provider | undefined) ?? resolveProvider(spec, brand);
  const mock = !!opts.mock;
  const voiceId = resolveVoice(spec, brand);
  // A spec whose every beat imports real VO (voFile) needs no TTS voice at all.
  const needsTts = spec.segments.some((s) => !s.voFile);
  if (!mock && needsTts && !voiceId) {
    throw new Error("No voice for a real build — set spec.voice or the brand's defaultVoice (or use --mock).");
  }
  const formats = (opts.format ? opts.format.split(",") : spec.format) as Format[];
  // After provider + formats are final (CLI overrides included) — the landscape guard needs both.
  assertLandscapeSupport(spec, formats, provider);
  const cache = new Cache(project.cache);

  log.info(`Building ${spec.title} · ${provider}${mock ? " · MOCK — no API spend" : ""}`);

  log.step("voiceover");
  const vo = await buildVO({
    spec,
    voiceId,
    cache,
    // All-voFile specs can run keyless (whisper STT); mixed/TTS specs still require the key.
    apiKey: mock || (!needsTts && !process.env.ELEVENLABS_API_KEY) ? undefined : requireKey("ELEVENLABS_API_KEY"),
    mock,
    model: resolveVoiceModel(spec, brand),
    needClips: provider !== "none",
    resolveAsset: (rel) => project.assetPath(rel),
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

  // Stage everything the render page reads via staticFile(): app assets, the avatar clip, and the VO track.
  const publicDir = join(project.outDir(spec.title), "_public");
  mkdirSync(publicDir, { recursive: true });
  // _scene3d is a cross-build Blender-stills cache, hash-keyed by timeline content — beside
  // _public, never wiped here (a fresh build's cache hits skip re-rendering unchanged scene beats).
  const scene3dDir = join(project.outDir(spec.title), "_scene3d");
  const staged = new Set<string>();
  const stageAsset = (rel: string) => {
    if (staged.has(rel)) return;
    staged.add(rel);
    const dest = join(publicDir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(project.assetPath(rel), dest);
  };
  for (const seg of spec.segments) {
    if (seg.kind === "app") {
      stageAsset(seg.asset);
      if (seg.frame) stageAsset(seg.frame.src);
    }
  }
  if (avatarRel && avatarPath) copyFileSync(avatarPath, join(publicDir, avatarRel));
  copyFileSync(vo.trackPath, join(publicDir, "vo.mp3"));
  // SFX + music bed: resolve (library id or project asset), stage into _public, warn on
  // placements the mix can't honour. duckSpans = per-segment VO spans (see MusicProps).
  const sfx = (spec.sfx ?? []).map((s, i) => {
    const abs = resolveAudioSource(s.src, project);
    const rel = `sfx-${i}${extname(abs)}`;
    copyFileSync(abs, join(publicDir, rel));
    if (s.at > vo.totalSec) log.warn(`sfx[${i}] at=${s.at}s is past the end of the VO (${vo.totalSec}s) — it will never play`);
    return { src: rel, at: s.at, volume: s.volume };
  });
  let music: KinoProps["music"] = null;
  if (spec.music) {
    const abs = resolveAudioSource(spec.music.src, project);
    const rel = `music${extname(abs)}`;
    copyFileSync(abs, join(publicDir, rel));
    if (spec.music.duck > spec.music.volume) log.warn(`music.duck (${spec.music.duck}) > music.volume (${spec.music.volume}) — ducking would boost the bed; check the values`);
    const musicSec = await probeDuration(abs);
    if (musicSec < vo.totalSec) log.warn(`music is ${musicSec.toFixed(1)}s but the video runs ${vo.totalSec.toFixed(1)}s — the bed plays once and goes silent after it ends`);
    music = {
      src: rel,
      volume: spec.music.volume,
      duck: spec.music.duck,
      fadeInSec: spec.music.fadeInSec,
      fadeOutSec: spec.music.fadeOutSec,
      duckSpans: vo.timings.map((t) => ({ from: t.startSec, to: t.endSec })),
    };
  }
  const logoAbs = resolveBrandFile(brand.logo, project);
  if (logoAbs) copyFileSync(logoAbs, join(publicDir, "logo.png"));
  const logoPos = resolveLogoPosition(spec.logoPosition ?? brand.logoPosition);
  const logo = logoAbs
    ? {
        src: "logo.png",
        sizePx: resolveLogoSize(spec.logoSize ?? brand.logoSize),
        x: logoPos.x,
        y: logoPos.y,
        keyframes: spec.logoKeyframes ?? [],
      }
    : null;

  // Faceless background: stage the image (image kind) or read the custom draw-fn (custom kind).
  const bgKind = (opts.background as ReturnType<typeof resolveBackgroundKind> | undefined) ?? resolveBackgroundKind(brand, spec);
  let bgImageRel: string | null = null;
  let bgCustomCode: string | null = null;
  if (bgKind === "image") {
    const imgAbs = resolveBrandFile(brand.facelessBackdrop, project);
    if (!imgAbs) throw new Error('background "image" needs brand.facelessBackdrop');
    copyFileSync(imgAbs, join(publicDir, "faceless-bg.png"));
    bgImageRel = "faceless-bg.png";
  } else if (bgKind === "custom") {
    const compRef = spec.backgroundComponent ?? brand.backgroundComponent;
    if (!compRef) {
      throw new Error(
        'background "custom" needs backgroundComponent on the spec or brand ' +
          '(bare id e.g. "brand-wash", or a path). See `kino backgrounds`.',
      );
    }
    bgCustomCode = readFileSync(resolveBackgroundComponent(compRef, project), "utf8");
  }
  const bgColors = resolveBackgroundColors(brand);
  const background = {
    kind: bgKind,
    image: bgImageRel,
    customCode: bgCustomCode,
    params: {
      colorA: bgColors[0],
      colorB: bgColors[1],
      colorC: bgColors[2],
      intensity: resolveBackgroundIntensity(brand, spec),
    },
    keyframes: spec.backgroundKeyframes ?? [],
    triggers: spec.backgroundTriggers ?? [],
  };

  // Brand font: a registry name downloads + stages a TTF for the captions; a raw CSS family passes
  // through. --font overrides brand.font for quick A/B.
  const fontName = opts.font ?? brand.font;
  const fontDef = lookupFont(fontName);
  let themeFont = fontName;
  let fontUrl: string | null = null;
  if (fontDef) {
    const ttf = await ensureFont(fontDef.name);
    if (ttf) {
      copyFileSync(ttf, join(publicDir, "font.ttf"));
      fontUrl = "font.ttf";
      themeFont = `"KinoBrandFont", "${fontDef.family}", Helvetica, Arial, sans-serif`;
    } else {
      log.warn(`Font "${fontDef.name}" unavailable (offline?) — using system fallback`);
      themeFont = `"${fontDef.family}", Helvetica, Arial, sans-serif`;
    }
  }
  // Label font for storyboard/montage labels (defaults to the caption font); also staged as a
  // second render-page typeface (themeLabelFont/labelFontUrl below) so motion beats can reach it via
  // --kino-label-font without re-resolving the brand's font choice.
  const labelDef = lookupFont(brand.labelFont ?? fontName);
  const labelFont = labelDef ? await ensureFont(labelDef.name) : null;
  let themeLabelFont: string | undefined;
  let labelFontUrl: string | null = null;
  if (labelDef) {
    if (labelFont) {
      copyFileSync(labelFont, join(publicDir, "label-font.ttf"));
      labelFontUrl = "label-font.ttf";
      themeLabelFont = `"KinoLabelFont", "${labelDef.family}", Helvetica, Arial, sans-serif`;
    } else {
      themeLabelFont = `"${labelDef.family}", Helvetica, Arial, sans-serif`;
    }
  }

  const c = brand.colors;
  const fps = 30;
  // Built ahead of renderSegments: 3D scene beats (below) need it for runScene, and it's otherwise
  // only assembled once, into `props`.
  const theme: Theme = {
    font: themeFont,
    fontUrl,
    labelFont: themeLabelFont,
    labelFontUrl,
    night: c.night,
    mint: c.mint,
    green: c.green,
    gold: c.gold,
    white: c.white,
    brandName: brand.name,
    captionFontSize: brand.captionStyle.fontSize,
    captionStroke: brand.captionStyle.strokeWidth,
    captionBg: resolveCaptionBackplate(brand.captionStyle.background, c.night),
    film: resolveFilm(spec, brand),
  };
  // Resolve a camera shot + transition per app cut-in (auto-vary, spec can override).
  let appIdx = 0;
  const renderSegments = spec.segments.map((seg, i) => {
    const captionMode = (seg.captionMode ?? spec.captionMode ?? brand.captionMode ?? "phrase") as "phrase" | "words";
    const startSec = vo.timings[i].startSec;
    // hold visuals to the next beat's start so nothing blinks off during the inter-beat VO gap
    const endSec = i + 1 < spec.segments.length ? vo.timings[i + 1].startSec : vo.timings[i].endSec;
    const look = resolveCaptionLook(seg, spec, brand.captionStyle);
    // Beat's spoken words, beat-relative — every motion graphic (beat or overlay) gets them so it can
    // type text in sync with the VO. Independent of captionMode: the words exist even with captions off.
    const motionWords = beatRelativeWords(vo.words[i], startSec);
    // atWord anchors resolve here — against THIS build's VO timings — so word-anchored
    // triggers/keyframes ride real TTS with no mock→real retune.
    const anchorMotion = (
      ref: {
        source: string;
        params?: Record<string, number | string>;
        keyframes?: { at?: number; atWord?: string | number; params: Record<string, number | string>; ease?: "linear" | "easeInOut" | "overshoot" | "spring" }[];
        triggers?: { at?: number; atWord?: string | number; action: string }[];
        loop?: boolean;
      },
      where: string,
    ): MotionGraphicRefInput => ({
      source: ref.source,
      params: ref.params,
      loop: ref.loop,
      keyframes: resolveWordAnchors(ref.keyframes, motionWords, `${where}.keyframes`),
      triggers: resolveWordAnchors(ref.triggers, motionWords, `${where}.triggers`),
    });
    const base = {
      kind: seg.kind,
      asset: seg.kind === "app" ? seg.asset : undefined,
      caption: seg.caption ?? "",
      startSec,
      endSec,
      captionMode,
      words: captionMode === "words" ? vo.words[i] : undefined,
      emphasis: captionMode === "words" ? seg.emphasis : undefined,
      captionKeyframes: seg.captionKeyframes,
      captionStyle: look.style,
      captionAnimation: look.animation,
      captionReveal: look.reveal,
      texts: resolveTexts(seg.texts, startSec, endSec, brand.captionStyle.fontSize, look),
    };
    if (seg.kind === "app") {
      const shot = pickShot(appIdx, seg.shot as Shot | undefined);
      const isVideo = /\.(mp4|mov)$/i.test(seg.asset ?? "");
      const transition = pickTransition(appIdx, seg.transition as Transition | undefined, isVideo);
      appIdx++;
      return {
        ...base,
        shot,
        transition,
        clipFrom: seg.clipFrom,
        clipTo: seg.clipTo,
        speed: seg.speed,
        pauseAt: seg.pauseAt,
        frame: seg.frame,
        zoomKeyframes: seg.zoomKeyframes,
        motionOverlay: seg.motionOverlay
          ? { ...resolveMotionGraphic(anchorMotion(seg.motionOverlay, `segment[${i}].motionOverlay`), project), words: motionWords }
          : undefined,
      };
    }
    if (seg.kind === "avatar") {
      return {
        ...base,
        cta: seg.cta || undefined,
        shot: seg.shot as Shot | undefined,
        motionOverlay: seg.motionOverlay
          ? { ...resolveMotionGraphic(anchorMotion(seg.motionOverlay, `segment[${i}].motionOverlay`), project), words: motionWords }
          : undefined,
      };
    }
    // motion segment: resolve the full-screen graphic; VO drives its duration like other beats.
    return {
      ...base,
      motion: {
        ...resolveMotionGraphic(
          anchorMotion({ source: seg.source, params: seg.params, keyframes: seg.keyframes, triggers: seg.triggers, loop: seg.loop }, `segment[${i}]`),
          project,
        ),
        words: motionWords,
      },
    };
  });

  // 3D scene assets referenced by literals/params inside .scene.js sources — staged like footage.
  for (const seg of renderSegments as KinoSegment[]) {
    for (const rel of seg.motion?.sceneAssets ?? []) stageAsset(rel);
    for (const rel of seg.motionOverlay?.sceneAssets ?? []) stageAsset(rel);
  }

  // Blender stills for every scene beat/overlay — hash-keyed under _scene3d; cache hits skip spawn.
  const fmt0 = formats[0] ?? "9:16";
  const { width: sceneW, height: sceneH } = DIMS[fmt0];
  const ensureOne = async (
    mg: MotionGraphicProps | undefined,
    quality: "draft" | "final" | "max",
    durationFrames: number,
    beatLabel: string,
  ): Promise<void> => {
    if (!mg?.scene) return;
    const frames = Math.max(1, durationFrames);

    // Pre-raster maps: digests are pure content hashes (cheap file reads) so the timeline hash is
    // known up front; the actual Chrome work is deferred to prepareAssets (Blender cache miss only).
    const refs = extractSceneRefs(mg.scene, mg.params as Record<string, number | string>);
    if (refs.violations.length) throw new Error(`3D beat "${beatLabel}": ${refs.violations.join("; ")}`);
    const rasterJobs: (() => Promise<void>)[] = [];
    const screens: Record<string, { dir: string; frames: number }> = {};
    const layers: Record<string, { path: string; aspect: number }> = {};
    for (const rel of refs.screens) {
      const raw = readFileSync(project.assetPath(rel), "utf8");
      const bad = lintMotionHtml(raw);
      if (bad.length) throw new Error(`3D beat "${beatLabel}" screen ${rel}: ${bad.join("; ")}`);
      const html = sanitizeMotionHtml(raw);
      const rOpts = {
        html, words: mg.words ?? [], theme, params: mg.params, keyframes: mg.keyframes,
        triggers: mg.triggers, fps, durationFrames: frames,
      };
      const dir = join("_screens", screenDigest(rOpts));
      screens[rel] = { dir, frames };
      const abs = join(publicDir, dir);
      rasterJobs.push(async () => {
        if (existsSync(abs) && readdirSync(abs).filter((f) => /^f\d{5}\.png$/.test(f)).length === frames) return;
        rmSync(abs, { recursive: true, force: true });
        await rasterizeScreen({ ...rOpts, outDir: abs });
      });
    }
    for (const rel of refs.layers) {
      const svg = readFileSync(project.assetPath(rel), "utf8");
      const p = join("_layers", `${layerDigest(svg)}.png`);
      layers[rel] = { path: p, aspect: svgAspect(svg) };
      const abs = join(publicDir, p);
      rasterJobs.push(async () => {
        if (existsSync(abs)) return;
        mkdirSync(dirname(abs), { recursive: true });
        await rasterizeLayer({ svg, outPath: abs });
      });
    }

    const { timeline, hash } = runScene({
      source: mg.scene,
      params: mg.params as Record<string, number | string>,
      words: mg.words ?? [],
      theme,
      width: sceneW,
      height: sceneH,
      fps,
      durationFrames: frames,
      quality,
      keyframes: mg.keyframes,
      triggers: mg.triggers,
      screens,
      layers,
    });
    log.info(`  · 3d ${beatLabel} (${quality}, ${timeline.meta.frameCount} frames)`);
    mg.sceneFrames = await ensureSceneStills({
      timeline,
      hash,
      scene3dDir,
      publicDir,
      beatLabel,
      prepareAssets: async () => { for (const job of rasterJobs) await job(); },
    });
    // Page renders SceneFrames, not the raw scene source.
    mg.scene = undefined;
  };
  for (let i = 0; i < renderSegments.length; i++) {
    const seg = renderSegments[i] as KinoSegment;
    const durationFrames = Math.max(1, Math.round((seg.endSec - seg.startSec) * fps));
    const specSeg = spec.segments[i] as { quality?: "draft" | "final" | "max"; motionOverlay?: { quality?: "draft" | "final" | "max" } };
    const q = (raw?: "draft" | "final" | "max"): "draft" | "final" | "max" =>
      opts.draft3d ? "draft" : (raw ?? "final");
    await ensureOne(seg.motion, q(specSeg.quality), durationFrames, `beat ${i}`);
    await ensureOne(seg.motionOverlay, q(specSeg.motionOverlay?.quality ?? specSeg.quality), durationFrames, `beat ${i} overlay`);
  }

  const props: KinoProps = {
    theme,
    fps,
    avatar: avatarRel,
    avatarWindows,
    voTrack: "vo.mp3",
    logo,
    background,
    disclosure: avatarRel ? brand.disclosure : (brand.facelessDisclosure ?? brand.disclosure),
    sfx,
    music,
    segments: renderSegments,
  };

  return { props, publicDir, scene3dDir, formats, project, spec, labelFont, words: vo.words };
}

export async function build(
  specPath: string,
  opts: {
    mock?: boolean;
    format?: string;
    provider?: string;
    background?: string;
    font?: string;
    tag?: string;
    project?: string;
    draft?: boolean; // force Eevee drafts for every 3D scene beat
  },
): Promise<string[]> {
  const { props, publicDir, scene3dDir, formats, project, spec } = await prepare(specPath, {
    ...opts,
    draft3d: !!opts.draft,
  });
  // Under-animation probe: sample each full-screen motion beat at a few progress points and warn
  // when the frames barely differ — a poster with a dissolve, not motion. Never fails the build.
  try {
    const picks = probeFramePicks(props.segments, props.fps);
    if (picks.length) {
      const dir = mkdtempSync(join(tmpdir(), "kino-probe-"));
      const frames = picks.flatMap((p) => p.frames.map((f, j) => ({ frame: f, name: `probe-${p.segment}-${j}` })));
      const outs = await renderStills({ props, publicDir, scene3dDir, format: formats[0], frames, outDir: dir });
      let k = 0;
      for (const p of picks) {
        const mine = outs.slice(k, k + p.frames.length);
        k += p.frames.length;
        const diffs: number[] = [];
        for (let j = 1; j < mine.length; j++) diffs.push(await imageMeanDiff(mine[j - 1], mine[j]));
        if (isUnderAnimated(diffs)) {
          log.warn(
            `segment[${p.segment}] motion graphic barely animates across the beat (probe Δ ` +
              `${diffs.map((d) => d.toFixed(2)).join(" / ")}) — add entrance/life/speech layers (skills/motion-design)`,
          );
        }
      }
      rmSync(dir, { recursive: true, force: true });
    }
  } catch (e) {
    log.warn(`motion probe skipped: ${(e as Error).message}`);
  }
  log.step("render");
  // Tag variant renders (explicit --tag, else a --background/--font override, else mock) so a
  // preview or variant never overwrites the shipped default render.
  const autoTag =
    opts.tag ??
    opts.background ??
    (opts.font ? opts.font.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : undefined) ??
    (opts.mock ? "mock" : undefined);
  const outName = variantName(spec.title, autoTag);
  // Mock builds are previews — take the fast encode preset; real builds keep the final quality.
  const outs = await renderVideo({
    props,
    publicDir,
    scene3dDir,
    formats,
    outDir: project.outDir(spec.title),
    title: outName,
    preset: opts.mock ? "veryfast" : "medium",
  });
  for (const o of outs) {
    // AAC pad past the last video frame → players flash black at EOF (and break seamless loops).
    try {
      const pad = await holdLastFrameToMatchAudio(o);
      if (pad > 0) log.info(`held last frame +${pad.toFixed(3)}s to match audio (no black EOF)`);
    } catch (e) {
      log.warn(`av-sync hold failed: ${(e as Error).message}`);
    }
    log.ok(o);
  }
  if (spec.seamlessLoop) {
    for (const o of outs) {
      try {
        await checkLoopSeam(o);
      } catch (e) {
        log.warn(`seamlessLoop seam check failed: ${(e as Error).message}`);
      }
    }
  }
  return outs;
}
