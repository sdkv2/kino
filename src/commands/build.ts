// Pipeline backbone: spec → VO → avatar plan/trim → faceless background → fonts → frame render.
// prepare() is the shared resolver that does everything up to (but not including) the final encode;
// the preview commands (still/storyboard/inspect) reuse it so they resolve through the exact same
// code path as a real build (note: they default to mock VO). build() adds only the render +
// variant-tagging on top.
import { readFileSync, mkdirSync, mkdtempSync, copyFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, isAbsolute } from "node:path";
import { resolveProject, type Project } from "../config/project.js";
import { loadProjectConfig } from "../config/projectConfig.js";
import { loadEnv, requireKey } from "../config/env.js";
import { loadBrand, DEFAULT_BRAND, type Brand } from "../config/brand.js";
import { parseSpec, type Spec } from "../spec/schema.js";
import { validateSpec, resolveProvider, resolveVoice, resolveVoiceLook, resolveVoiceModel, resolveFilm } from "../spec/validate.js";
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
import { resolveBackgroundComponent, isShaderPath } from "../media/backgroundLib.js";
import { renderVideo, renderStills, variantName } from "../render/render.js";
import type { BgTexture, KinoProps, WordTiming } from "../render/props.js";
import { resolveCaptionLook, resolveTexts } from "../render/textStyles.js";
import { pickShot, pickTransition, type Shot, type Transition } from "../render/motion.js";
import { resolveMotionGraphic, sanitizeMotionHtml, type MotionGraphicRefInput } from "../render/motiongraphic.js";
import { beatRelativeWords, resolveWordAnchors } from "../render/motionVars.js";
import { probeFramePicks, isUnderAnimated } from "../render/motionProbe.js";
import { checkLoopSeam, imageMeanDiff } from "../media/loopSeam.js";
import { holdLastFrameToMatchAudio } from "../media/avSync.js";
import { log } from "../log.js";

// Foreground (text) colour for a kicker pill, keyed by the kicker's brand background colour: a
// near-black ink on the light mint/gold chips, white on the green chip — each picked for contrast.
// The background colours themselves come from the brand palette (see DEFAULT_BRAND.colors in
// config/brand.ts).
const KICKER_FG: Record<string, string> = { mint: "#06210f", green: "#ffffff", gold: "#0b1020" };

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

// Let a spec path be given relative to its project, not just cwd: `still specs/x.json --project p`
// now resolves `projects/p/specs/x.json`. Tries as-given first (abs / cwd-relative), then under the
// project root, then its specs/ dir. Falls through unchanged so a genuinely missing file still
// throws a clear ENOENT downstream.
function resolveSpecPathIn(specPath: string, project: Project): string {
  if (existsSync(specPath)) return specPath;
  for (const cand of [join(project.projectRoot, specPath), join(project.projectRoot, "specs", basename(specPath))]) {
    if (existsSync(cand)) return cand;
  }
  return specPath;
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
  formats: Array<"9:16" | "3:4" | "16:9">;
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
    mock?: boolean; // deprecated alias of `draft`
    draft?: boolean;
    tts?: boolean; // default true on a full render; false = silent (full quality). commander --no-tts.
    avatar?: boolean; // default true on a full render; false = faceless. commander --no-avatar.
    format?: string;
    provider?: string;
    background?: string;
    font?: string;
    project?: string;
  },
): Promise<PrepareResult> {
  const project = resolveProject({ specPath, project: opts.project });
  specPath = resolveSpecPathIn(specPath, project);
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
  // Three independent build axes (draft/mock is just the all-off, no-spend preset):
  //   draft  → fast free preview: silent VO + placeholder avatar + veryfast/low-SS encode
  //   tts    → real voiceover (off = silent, but FULL quality). commander --no-tts.
  //   avatar → real presenter  (off = faceless, full quality; forced off whenever tts is off,
  //            since a lip-synced avatar has nothing to sync to). commander --no-avatar.
  const draft = !!(opts.draft || opts.mock);
  const tts = !draft && opts.tts !== false;
  const wantAvatar = tts && opts.avatar !== false;
  // --no-avatar (or silent) routes through the existing faceless path by forcing provider "none".
  const provider = wantAvatar ? ((opts.provider as Provider | undefined) ?? resolveProvider(spec, brand)) : "none";
  const voiceId = resolveVoice(spec, brand);
  // A spec whose every beat imports real VO (voFile) needs no TTS voice at all.
  const needsTts = spec.segments.some((s) => !s.voFile);
  if (tts && needsTts && !voiceId) {
    throw new Error("No voice for a speaking build — set spec.voice or the brand's defaultVoice (or use --no-tts / --draft).");
  }
  const formats = (opts.format ? opts.format.split(",") : spec.format) as Array<"9:16" | "3:4" | "16:9">;
  const cache = new Cache(project.cache);

  const modeNote = draft ? " · draft (fast preview, no API spend)" : tts ? "" : " · no VO (silent, full quality)";
  log.info(`Building ${spec.title} · ${provider}${modeNote}`);

  log.step("voiceover");
  const vo = await buildVO({
    spec,
    voiceId,
    cache,
    // No TTS → silent placeholder track (buildVO mock path), no key. All-voFile specs can run
    // keyless (whisper STT); mixed/TTS specs still require the key.
    apiKey: !tts || (!needsTts && !process.env.ELEVENLABS_API_KEY) ? undefined : requireKey("ELEVENLABS_API_KEY"),
    mock: !tts,
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
    avatarPath = await buildAvatar({ provider, audioPath: avTrack, source, brand, cache, mock: false });
    avatarRel = "avatar.mp4";
    log.info(`  · ${plan.avatarIndices.length}/${spec.segments.length} segments on camera (trimmed)`);
  }

  // Stage everything the render page reads via staticFile(): app assets, the avatar clip, and the VO track.
  const publicDir = join(project.outDir(spec.title), "_public");
  mkdirSync(publicDir, { recursive: true });
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
  // Motion HTML can't use relative url() in CSS (determinism lint) — raster siblings are served via
  // <img src="/public/motion/..."> and staged here.
  const motionAssets = join(project.projectRoot, "assets", "motion");
  if (existsSync(motionAssets)) {
    for (const f of readdirSync(motionAssets)) {
      if (/\.(html|js|json)$/i.test(f)) continue;
      stageAsset(`motion/${f}`);
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
  let bgShaderCode: string | null = null;
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
    const compPath = resolveBackgroundComponent(compRef, project);
    const code = readFileSync(compPath, "utf8");
    if (isShaderPath(compPath)) bgShaderCode = code;
    else bgCustomCode = code;
  }
  // Shader texture channels (uTex0..uTex3): images staged into /public, motion HTML sanitized and
  // rasterized page-side at load. Only meaningful when the background is a shader.
  const bgTextures: BgTexture[] = [];
  if (spec.backgroundTextures?.length) {
    if (!bgShaderCode) {
      throw new Error('backgroundTextures needs a shader background (backgroundComponent → .frag/.glsl)');
    }
    spec.backgroundTextures.forEach((entry, i) => {
      const ref = typeof entry === "string" ? entry : entry.source;
      const param = typeof entry === "object" && "param" in entry ? entry.param : undefined;
      const isVideo = typeof entry === "object" && "kind" in entry && entry.kind === "video";
      const asAsset = project.assetPath(ref);
      const abs = existsSync(asAsset) ? asAsset : isAbsolute(ref) ? ref : join(project.workspaceRoot, ref);
      if (!existsSync(abs)) throw new Error(`backgroundTextures[${i}] not found: tried assets/${ref} and ${ref}`);
      const ext = extname(abs).toLowerCase();
      if (ext === ".html") {
        bgTextures.push({ kind: "html", src: null, html: sanitizeMotionHtml(readFileSync(abs, "utf8")), param });
      } else {
        if (param) throw new Error(`backgroundTextures[${i}]: param only applies to .html sources`);
        // Video masks and static images both stage a file under /public; only the kind differs
        // (video is seeked + redrawn per frame, image uploads once).
        const staged = `bg-tex-${i}${ext}`;
        copyFileSync(abs, join(publicDir, staged));
        bgTextures.push({ kind: isVideo ? "video" : "image", src: staged, html: null });
      }
    });
  }
  const bgColors = resolveBackgroundColors(brand);
  const background = {
    kind: bgKind,
    image: bgImageRel,
    customCode: bgCustomCode,
    shaderCode: bgShaderCode,
    textures: bgTextures,
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
        keyframes?: { at?: number; atWord?: string | number; params: Record<string, number | string>; ease?: import("../render/bgparams.js").Ease }[];
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
        kickerKeyframes: seg.kickerKeyframes,
        zoomKeyframes: seg.zoomKeyframes,
        kicker: seg.kicker
          ? { text: seg.kicker.text, color: c[seg.kicker.color], fg: KICKER_FG[seg.kicker.color] }
          : undefined,
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

  const props: KinoProps = {
    theme: {
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
    },
    fps: 30,
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

  return { props, publicDir, formats, project, spec, labelFont, words: vo.words };
}

export async function build(
  specPath: string,
  opts: {
    mock?: boolean; // deprecated alias of draft
    draft?: boolean;
    tts?: boolean;
    avatar?: boolean;
    format?: string;
    provider?: string;
    background?: string;
    font?: string;
    tag?: string;
    project?: string;
  },
): Promise<string[]> {
  const { props, publicDir, formats, project, spec } = await prepare(specPath, opts);
  // Only a draft is low-quality; a full render — even a silent (--no-tts) or faceless (--no-avatar)
  // one — keeps final quality and a clean, untagged filename.
  const draft = !!(opts.draft || opts.mock);
  // Under-animation probe: sample each full-screen motion beat at a few progress points and warn
  // when the frames barely differ — a poster with a dissolve, not motion. Never fails the build.
  try {
    const picks = probeFramePicks(props.segments, props.fps);
    if (picks.length) {
      const dir = mkdtempSync(join(tmpdir(), "kino-probe-"));
      const frames = picks.flatMap((p) => p.frames.map((f, j) => ({ frame: f, name: `probe-${p.segment}-${j}` })));
      const outs = await renderStills({ props, publicDir, format: formats[0], frames, outDir: dir });
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
  // Tag variant renders (explicit --tag, else a --background/--font override, else draft) so a
  // preview or variant never overwrites the shipped default render.
  const autoTag =
    opts.tag ??
    opts.background ??
    (opts.font ? opts.font.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : undefined) ??
    (draft ? "draft" : undefined);
  const outName = variantName(spec.title, autoTag);
  // Drafts are previews — take the fast encode preset; full renders keep the final quality.
  const outs = await renderVideo({ props, publicDir, formats, outDir: project.outDir(spec.title), title: outName, preset: draft ? "veryfast" : "medium" });
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
