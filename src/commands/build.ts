// Pipeline backbone: spec → VO → presenter plan/trim → background → fonts → frame render.
// prepare() is the shared resolver that does everything up to (but not including) the final encode;
// the preview commands (still/storyboard/inspect) reuse it so they resolve through the exact same
// code path as a real build (note: they default to mock VO). build() adds only the render +
// variant-tagging on top.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, readdirSync } from "node:fs";
import { basename, dirname, extname, join, isAbsolute } from "node:path";
import { releaseScratch, scratchDir } from "../scratch.js";
import { resolveProject, type Project } from "../config/project.js";
import { loadProjectConfig } from "../config/projectConfig.js";
import { loadEnv, requireKey } from "../config/env.js";
import { loadBrand, DEFAULT_BRAND, type Brand } from "../config/brand.js";
import { resolvePalette, type Palette } from "../config/palettes.js";
import { readableInk } from "../render/contrast.js";
import { loadSpec, parseSpec, type Spec } from "../spec/schema.js";
import { validateSpec, resolveProvider, resolveVoice, resolveVoiceLook, resolveVoiceModel, resolveFilm } from "../spec/validate.js";
import { needsSourceImage, type Provider } from "../avatar/provider.js";
import { Cache } from "../media/cache.js";
import { contentHash } from "../media/hash.js";
import { defaultInlineSvgRel, isRasterImagePath, prepareInlineSvg } from "../media/imageAsset.js";
import { buildVO, GAP, type VoMode } from "../vo/vo.js";
import { buildAvatar } from "../avatar/avatar.js";
import { planAvatarWindows } from "../avatar/plan.js";
import { presenterBeats, resolvePresenterPin } from "../avatar/source.js";
import { resolveBackgroundKind, resolveBackgroundColors, resolveBackgroundIntensity } from "../render/background.js";
import { resolveFontCuts } from "../fonts/registry.js";
import { resolveTransitionSource } from "../media/transitionLib.js";
import { ensureFont, resolveFont } from "../fonts/manager.js";
import { resolveCaptionBackplate } from "../render/elements.js";
import { probeDuration, stitchAudio } from "../media/ffmpeg.js";
import { resolveAudioSource } from "../media/sfx.js";
import { resolveBackgroundComponent, isShaderPath } from "../media/backgroundLib.js";
import { parseQuality } from "../render/native/engine.js";
import { renderVideo, renderStills, variantName } from "../render/render.js";
import { parseFormatList, type FormatId } from "../render/formats.js";
import type { BgKeyframe, BgParamValue, BgTexture, KinoProps, RegionShaderProps, RegionTexture, WordTiming } from "../render/props.js";
import type { PostFx } from "../render/postSpec.js";
import type { DeclaredLayer } from "../render/layerSpec.js";
import type { LayerEffect, LayerMask } from "../render/maskSpec.js";
import type { BlendMode } from "../render/native/page/compositor/graph.js";
import { readManifest } from "../segment/manifest.js";
import { resolveCaptionLook, resolveTexts } from "../render/textStyles.js";
import { pickShot, pickTransition, type Shot, type Transition } from "../render/motion.js";
import { resolveMotionGraphic, sanitizeMotionHtml, type MotionGraphicRefInput } from "../render/motiongraphic.js";
import { beatRelativeWords, resolveWordAnchors } from "../render/motionVars.js";
import { runMotionQa } from "../render/motionQa.js";
import { checkLoopSeam } from "../media/loopSeam.js";
import { holdLastFrameToMatchAudio } from "../media/avSync.js";
import { log } from "../log.js";

// Which palette role a kicker pill takes its chip colour from. Roles are canonical; the literal
// names are the pre-rename aliases for the same slots.
const KICKER_SLOT = { accent: "accent", mint: "accent", deep: "deep", green: "deep", accent2: "accent2", gold: "accent2" } as const;

// The pill's text colour is DERIVED from the chip, not tabulated per role: a table keyed by role
// only holds while the palette is kino's own (light accents, dark base). Under `paper` — or any
// scheme with a saturated accent — a hardcoded near-black ink lands on dark blue and disappears.
// Every dark-base palette still resolves to the near-black/white pair the old table hardcoded.
const kickerFg = (chip: string, colors: Palette): string => readableInk(chip, colors.fg, colors.bg);

// Resolve an app beat's regionShader spec → RegionShaderProps: read each mask's manifest for kind +
// the chosen object's channel, stage the mask file into /public (like frame.src / asset), and load
// each region's .frag/.glsl body the same way a custom shader background is loaded. `mask`+`object`
// is the single-entry shorthand for `masks`. An entry's own `subject` shades just that mask
// (per-object regions); entries without one fall back to the top-level `subject`, which is how
// several independently `kino segment`-ed subjects share one treatment on one background.
function resolveRegionShader(
  rs: {
    mask?: string;
    masks?: { mask: string; object: number; subject?: string }[];
    subject?: string;
    background?: string;
    backdrop?: string;
    object: number;
    // Shared by every body in the beat's one program; `keyframes[].at` is beat-relative seconds.
    // The 4-slot ceiling is enforced in the schema (see slotParamNames), so no re-check here.
    params?: Record<string, BgParamValue>;
    keyframes?: BgKeyframe[];
    textures?: string[];
  },
  project: Project,
  stageAsset: (rel: string) => void,
): RegionShaderProps {
  const loadBody = (ref: string | undefined) => (ref ? readFileSync(resolveBackgroundComponent(ref, project), "utf8") : null);
  const entries = rs.masks ?? [{ mask: rs.mask!, object: rs.object, subject: undefined }];
  const masks = entries.map(({ mask, object, subject }) => {
    const manifest = readManifest(project.assetPath(mask));
    // Image masks carry every object in the single union mask.png (all channel "gray"); per-object
    // image selection isn't wired, so object>0 would silently pick the same union — reject it loudly.
    // Multi-object addressing lives on video masks (distinct R/G/B channels).
    if (manifest.kind === "image" && object > 0) {
      throw new Error(`regionShader object must be 0 for image mask "${mask}" — per-object selection is only supported on video masks.`);
    }
    const obj = manifest.objects[object];
    if (!obj) {
      throw new Error(`regionShader object ${object} out of range for mask "${mask}" (${manifest.objects.length} objects)`);
    }
    const maskRel = `${mask}/${manifest.kind === "video" ? "mask.mp4" : "mask.png"}`;
    stageAsset(maskRel);
    return { maskSrc: maskRel, maskKind: manifest.kind, channel: obj.channel, subjectCode: loadBody(subject) };
  });
  // The backdrop clip is staged like the mask/asset — the page fetches it from publicDir by this
  // same relative path, and videoFrames.ts extracts it there when it's a video.
  if (rs.backdrop) stageAsset(rs.backdrop);
  // Extra sampler channels (uTex2..uTex3). A motion .html resolves and lints exactly like a
  // motionOverlay source — same library ids, same determinism lint, same sanitizer — but its markup
  // is rasterized into a texture the region bodies sample, instead of compositing above them.
  // Tier-2 (.js) and Tier-3 (.json) stay overlay-only: their markup is produced per frame by the
  // React layer, which the shader cannot reach (see docs/segmentation.md).
  const textures: RegionTexture[] = (rs.textures ?? []).map((ref, i) => {
    if (/\.(png|jpe?g|webp|svg)$/i.test(ref)) {
      const abs = project.assetPath(ref);
      if (!existsSync(abs)) throw new Error(`regionShader.textures[${i}] not found: assets/${ref}`);
      stageAsset(ref);
      return { kind: "image" as const, src: ref, html: null };
    }
    const graphic = resolveMotionGraphic({ source: ref }, project);
    if (!graphic.html) {
      throw new Error(
        `regionShader.textures[${i}] "${ref}": only Tier-1 .html rasterizes into a texture channel ` +
          `(a .js/.json graphic renders per frame in the DOM layer — use motionOverlay for it).`,
      );
    }
    return { kind: "html" as const, src: null, html: graphic.html };
  });
  return {
    masks,
    subjectCode: loadBody(rs.subject),
    backgroundCode: loadBody(rs.background),
    backdrop: rs.backdrop,
    params: rs.params,
    keyframes: rs.keyframes,
    textures: textures.length ? textures : undefined,
  };
}

// Resolve every declared layer's source into what its provider actually consumes — the render page
// never reads files (registry.ts's own header comment). Every built-in layer gets this kind of
// resolution already (stageAsset for a file, resolveBackgroundComponent + readFileSync for a
// shader body — see bgShaderCode below — resolveMotionGraphic for motion/lottie); nothing did it
// for declared layers, so a validated layer built successfully and painted nothing (task-7-report.md,
// task-7b-brief.md). An adjustment layer (no `source`) has no pixels and passes through untouched.
// Throws, naming the layer id, when a source can't become something a provider can draw — never
// returns a layer that silently paints nothing, because renderer.ts's compositeLayerInner just
// no-ops a missing TextureSource (`if (!source) return`) with no error of its own.
function resolveDeclaredLayers(
  layers: DeclaredLayer[] | undefined,
  project: Project,
  stageAsset: (rel: string) => void,
  stageInlineContent: (rel: string, content: string) => void,
): DeclaredLayer[] | undefined {
  if (!layers) return layers;
  return layers.map((d) => {
    if (!d.source) return d; // adjustment layer (grade/blur/etc. chain) — no pixels to resolve
    const { kind, src: rawSrc, svg: inlineSvg } = d.source;
    const src = rawSrc ?? (inlineSvg ? defaultInlineSvgRel(d.id) : "");
    const fail = (msg: string): never => {
      throw new Error(`layer "${d.id}": ${msg}`);
    };

    if (kind === "image") {
      if (inlineSvg) {
        const rel = rawSrc ?? defaultInlineSvgRel(d.id);
        stageInlineContent(rel, prepareInlineSvg(inlineSvg));
        const { svg: _drop, ...source } = d.source;
        return { ...d, source: { ...source, src: rel, url: rel } };
      }
      if (!src) fail("image layer needs source.src or source.svg");
      if (!existsSync(project.assetPath(src))) fail(`image not found: assets/${src}`);
      if (!isRasterImagePath(src)) fail(`source.src "${src}" is not a raster image`);
      stageAsset(src);
      return { ...d, source: { ...d.source, url: src } };
    }

    if (kind === "video") {
      const isStill = isRasterImagePath(src);
      if (!src) fail("video layer needs source.src");
      if (!existsSync(project.assetPath(src))) fail(`video source not found: assets/${src}`);
      if (!isStill) {
        // GAP (task-7-report.md / task-7b-brief.md): videoFrames.ts's planMediaJobs walks
        // props.segments and props.avatarWindows only — it never walks props.layers, so a declared
        // video layer never gets a MediaEntry and createFramesSource has nothing to draw (registry.ts
        // falls back to a still image only when the extension matches one). Staging the file and
        // calling it "resolved" would reproduce exactly the silent-nothing bug this task exists to
        // close, just one layer deeper — fail loudly here instead until a job planner walks
        // declared layers too.
        fail(
          `source.src "${src}": a declared "video" layer needs per-frame extraction, which is not wired ` +
            `up yet (videoFrames.ts's planMediaJobs walks segments/avatarWindows, not spec.layers) — ` +
            `use a still image (.png/.jpg/.jpeg/.webp/.svg) for a declared "video" layer for now`,
        );
      }
      stageAsset(src);
      return { ...d, source: { ...d.source, url: src } };
    }

    if (kind === "shader") {
      let abs: string;
      try {
        abs = resolveBackgroundComponent(src, project);
      } catch (e) {
        return fail((e as Error).message);
      }
      // resolveBackgroundComponent resolves a bare id against the whole backgrounds library, which
      // holds both .frag/.glsl shaders AND .js Canvas2D draw components (e.g. "brand-wash") — same
      // ambiguity the main background resolution disambiguates with isShaderPath (see bgShaderCode
      // below). Without this check, a bare id pointing at a .js component would have its JS source
      // read as GLSL, registered, and only fail during the first seek — after VO/avatar spend.
      if (!isShaderPath(abs)) {
        fail(`source.src "${src}" resolved to "${abs}", which is not a shader (.frag/.glsl) — a declared "shader" layer can't use a Canvas2D draw component`);
      }
      return { ...d, source: { ...d.source, shaderCode: readFileSync(abs, "utf8") } };
    }

    // motion | lottie: resolveMotionGraphic dispatches Tier 1/2/3 by the file EXTENSION, not by
    // this declared `kind` — so it would happily resolve a "lottie" layer pointed at a .html file
    // as sanitized markup (graphic.lottie left undefined). registry.ts routes a "lottie" kind to
    // createLottieSource, which reads only graphic.lottie — that mismatch would silently paint
    // nothing, so it's rejected here rather than left to surface as an empty layer.
    try {
      const graphic = resolveMotionGraphic(
        { source: src, params: d.source.params, keyframes: d.source.keyframes, triggers: d.source.triggers },
        project,
      );
      if (kind === "lottie" && !graphic.lottie) fail(`source.kind is "lottie" but "${src}" did not resolve to a Lottie animation`);
      if (kind === "motion" && graphic.lottie) fail(`source.kind is "motion" but "${src}" is a Lottie (.json) file — use kind "lottie"`);
      return { ...d, source: { ...d.source, graphic } };
    } catch (e) {
      return fail((e as Error).message);
    }
  });
}

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

// Resolve an optional brand asset (e.g. backdrop) — brands are shared, so paths are workspace-relative.
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
  const dir = scratchDir("kino-avtrk-");
  try {
    const tmp = join(dir, "avtrack.mp3");
    await stitchAudio(avClips, GAP, tmp);
    return cache.put(key, "mp3", tmp);
  } finally {
    releaseScratch(dir);
  }
}

/** The three build axes, resolved from the CLI flags. */
export interface BuildAxes {
  /** Fast, cheap preview: 720p canvas + low-quality encode. Never speaks, never has a presenter. */
  draft: boolean;
  /** Where the voiceover comes from. `"tts"` IS THE ONLY VALUE THAT SPENDS MONEY. */
  vo: VoMode;
  /** Real presenter. Requires `vo: "tts"` — a lip-synced avatar has nothing to sync to without speech. */
  avatar: boolean;
}

/**
 * Resolve the build axes from CLI flags. Pure, so the cost rules are testable without a project
 * on disk (`tests/build-axes.test.ts`).
 *
 * **Voice is opt-in.** A bare `kino build <spec>` renders SILENT at FULL quality and spends
 * nothing; `--tts` is the single flag that bills ElevenLabs. This inverts the older `--no-tts`,
 * which made spend the default and hid "free but full quality" behind a double negative — easy to
 * miss, and the expensive way to be wrong. `--draft` is now only about render speed and size, so
 * "how cheap" and "how good" are two separate questions instead of one tangled preset.
 *
 * **`--real` is the free half of `--tts`.** It reuses voiceover a previous `--tts` build already
 * paid for and errors if there is none, so every command that reads true timings (still,
 * storyboard, inspect, retune, sync) can do so without a spending flag of its own.
 */
export function resolveBuildAxes(opts: {
  draft?: boolean;
  mock?: boolean;
  tts?: boolean;
  real?: boolean;
  avatar?: boolean;
}): BuildAxes {
  const draft = !!(opts.draft || opts.mock);
  // A draft is a structural preview — speaking would defeat its purpose (and cost money). Past
  // that, --tts outranks --real: it is the superset (it fills the very cache --real reads).
  const vo: VoMode = draft ? "mock" : opts.tts ? "tts" : opts.real ? "cached" : "mock";
  const avatar = vo === "tts" && opts.avatar !== false;
  return { draft, vo, avatar };
}

export interface PrepareResult {
  props: KinoProps;
  publicDir: string;
  formats: FormatId[];
  project: Project;
  spec: Spec;
  labelFont: string | null; // absolute TTF path for storyboard/montage labels, if resolved
  words: WordTiming[][]; // per-segment word timings, absolute on the main timeline
}


/** `transition: "custom"` → the author's shader body, resolved and read at build time so the render
 *  page never touches the filesystem. Absent for every built-in transition. */
function readTransitionSource(
  seg: { transition?: string; transitionSource?: string },
  project: Project,
): string | undefined {
  if (seg.transition !== "custom" || !seg.transitionSource) return undefined;
  return readFileSync(resolveTransitionSource(seg.transitionSource, project), "utf8");
}

// Everything build does up to (but not including) the final video render. Reused by the
// inspection commands (still/storyboard/inspect) so they share the exact pipeline.
export async function prepare(
  specPath: string,
  opts: {
    mock?: boolean; // deprecated alias of `draft`
    draft?: boolean;
    tts?: boolean; // OPT-IN (commander --tts). Absent = silent, full quality, no spend.
    real?: boolean; // reuse the real VO a --tts build cached. Never spends; errors on a miss.
    avatar?: boolean; // default true once tts is on; false = no presenter. commander --no-avatar.
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
  const spec = loadSpec(specPath);

  // A project.json assigns a brand + optional default overrides (layered under spec/CLI).
  const pc = loadProjectConfig(project.projectConfigPath);
  const brandName = spec.brand ?? pc?.brand;
  const rawBrand = brandName ? loadBrand(project.brandDir(brandName)) : DEFAULT_BRAND;
  const brand: Brand = {
    ...rawBrand,
    // The spec's colour scheme lands here, so every downstream reader of brand.colors — captions,
    // motion vars, background gradients, kicker chips, the film pass — picks it up unchanged.
    colors: resolvePalette(spec.colors, rawBrand.colors),
    defaultProvider: pc?.provider ?? rawBrand.defaultProvider,
    background: pc?.background ?? rawBrand.background,
    font: pc?.font ?? rawBrand.font,
    captionMode: pc?.captionMode ?? rawBrand.captionMode,
  };
  validateSpec(spec, brand, project);
  const { draft, vo: voMode, avatar: wantAvatar } = resolveBuildAxes(opts);
  // A beat may pin its provider/look via `source: "heygen:look-id"`; otherwise "avatar:" takes
  // whatever the spec/brand/project configures. --no-avatar (or silent) drops to "none".
  const pin = resolvePresenterPin(spec);
  const provider = wantAvatar
    ? ((opts.provider as Provider | undefined) ?? pin?.provider ?? resolveProvider(spec, brand))
    : "none";
  const voiceId = resolveVoice(spec, brand);
  // A spec whose every beat imports real VO (voFile) needs no TTS voice at all.
  const needsTts = spec.segments.some((s) => !s.voFile);
  // `--real` needs the voice too: it is part of the VO cache key, so without it there is no entry
  // to look up — not just nothing to synthesise.
  if (voMode !== "mock" && needsTts && !voiceId) {
    const flag = voMode === "tts" ? "--tts" : "--real";
    throw new Error(`${flag} needs a voice — set spec.voice or the brand's defaultVoice (or drop ${flag} for a silent, full-quality render).`);
  }
  const formats: FormatId[] = opts.format ? parseFormatList(opts.format) : (spec.format as FormatId[]);
  const cache = new Cache(project.cache);

  const modeNote = draft
    ? " · draft (fast preview, no API spend)"
    : voMode === "tts"
      ? ""
      : voMode === "cached"
        ? " · real VO (from cache, no API spend)"
        : " · no VO (silent, full quality)";
  log.info(`Building ${spec.title} · ${provider}${modeNote}`);

  log.step("voiceover");
  const vo = await buildVO({
    spec,
    voiceId,
    cache,
    // No TTS → silent placeholder track (buildVO mock path), no key. All-voFile specs can run
    // keyless (whisper STT); mixed/TTS specs still require the key. `--real` reads the cache and
    // never calls out, so it stays keyless too.
    apiKey: voMode !== "tts" || (!needsTts && !process.env.ELEVENLABS_API_KEY) ? undefined : requireKey("ELEVENLABS_API_KEY"),
    vo: voMode,
    specRef: specPath,
    model: resolveVoiceModel(spec, brand),
    needClips: provider !== "none",
    resolveAsset: (rel) => project.assetPath(rel),
  });

  log.step("presenter");
  const plan = planAvatarWindows(presenterBeats(spec), vo.timings, GAP);
  const avatarWindows = plan.windows; // contiguous on-camera runs: presenter placement on the timeline
  let avatarRel: string | null = null;
  let avatarPath: string | null = null;
  if (provider === "none" || plan.avatarIndices.length === 0) {
    log.info("  · no presenter");
  } else {
    const avTrack = await stitchAvatarTrack(vo.clips, plan.avatarIndices, cache);
    // A beat's pinned look (after the colon in `source`) overrides the spec/brand one.
    const source =
      pin?.look ??
      (provider === "heygen" ? resolveVoiceLook(spec, brand).lookId : resolveSourceImage(spec, brand, project, provider));
    avatarPath = await buildAvatar({ provider, audioPath: avTrack, source, brand, cache, mock: false });
    avatarRel = "avatar.mp4";
    log.info(`  · ${plan.avatarIndices.length}/${spec.segments.length} segments on camera (trimmed)`);
  }

  // Stage everything the render page reads via staticFile(): video assets, the presenter clip, and the VO track.
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
  const stageInlineContent = (rel: string, content: string) => {
    if (staged.has(rel)) return;
    staged.add(rel);
    const dest = join(publicDir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content, "utf8");
  };
  for (const seg of spec.segments) {
    if (seg.kind === "video") {
      stageAsset(seg.source);
      if (seg.frame) stageAsset(seg.frame.src);
    }
  }
  // Author-declared layers (spec.layers): resolve each source into what its provider actually
  // consumes — see resolveDeclaredLayers's own header comment. Runs here (same place as the
  // segment asset staging just above) so it shares this one stageAsset/staged Set.
  const layers = resolveDeclaredLayers(spec.layers as DeclaredLayer[] | undefined, project, stageAsset, stageInlineContent);
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
      startSec: spec.music.startSec,
      duckSpans: vo.timings.map((t) => ({ from: t.startSec, to: t.endSec })),
    };
  }
  // Faceless background: stage the image (image kind) or read the custom draw-fn (custom kind).
  const bgKind = (opts.background as ReturnType<typeof resolveBackgroundKind> | undefined) ?? resolveBackgroundKind(brand, spec);
  let bgImageRel: string | null = null;
  let bgCustomCode: string | null = null;
  let bgShaderCode: string | null = null;
  if (bgKind === "image") {
    const imgAbs = resolveBrandFile(brand.backdrop, project);
    if (!imgAbs) throw new Error('background "image" needs brand.backdrop');
    copyFileSync(imgAbs, join(publicDir, "backdrop.png"));
    bgImageRel = "backdrop.png";
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

  // Brand font: any Google Fonts family name downloads + stages a TTF for the captions; a raw CSS
  // stack passes through. --font overrides brand.font for quick A/B.
  const fontName = opts.font ?? brand.font;
  const font = await resolveFont(fontName);
  let themeFont = fontName;
  let fontUrl: string | null = null;
  const fontFaces: { weight: number; url: string }[] = [];
  if (font) {
    const ttf = await ensureFont(font.family, font.weight);
    if (ttf) {
      copyFileSync(ttf, join(publicDir, "font.ttf"));
      fontUrl = "font.ttf";
      themeFont = `"KinoBrandFont", "${font.family}", Helvetica, Arial, sans-serif`;
      // Opt-in extra cuts, spec overriding brand. The caption weight is always in the set, so a page
      // that asks for it still resolves; a cut that fails to download is skipped rather than failing
      // the build. `exact` so a missing cut is reported, not silently staged as the regular face.
      const wanted = resolveFontCuts(font.weight, spec.fontWeights, brand.fontWeights);
      for (const w of wanted) {
        const cut = w === font.weight ? ttf : await ensureFont(font.family, w, { exact: true });
        if (!cut) {
          log.warn(`Font "${font.family}" weight ${w} unavailable — that cut will fall back`);
          continue;
        }
        const rel = `font-${w}.ttf`;
        copyFileSync(cut, join(publicDir, rel));
        fontFaces.push({ weight: w, url: rel });
      }
    } else {
      const hint = font.suggestion ? ` Did you mean "${font.suggestion}"?` : "";
      log.warn(`Font "${font.family}" unavailable (unknown family, or offline?) — using system fallback.${hint}`);
      themeFont = `"${font.family}", Helvetica, Arial, sans-serif`;
    }
  }
  // Label font for storyboard/montage labels (defaults to the caption font); also staged as a
  // second render-page typeface (themeLabelFont/labelFontUrl below) so motion beats can reach it via
  // --kino-label-font without re-resolving the brand's font choice.
  const labelDef = await resolveFont(brand.labelFont ?? fontName);
  const labelFont = labelDef ? await ensureFont(labelDef.family, labelDef.weight) : null;
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
      source: seg.kind === "video" ? seg.source : undefined,
      // mask/effects/blend: spec-side types are permissive (z.unknown()) so validateSegmentFx can
      // report actionable errors instead of Zod stripping bad values — cast to the concrete
      // KinoSegment shapes here. These three MUST stay threaded onto `base` (shared by every
      // segment kind below); their absence was invisible for a whole release because every mask/fx
      // test builds KinoProps directly and never goes through this mapping. Keep in sync with
      // KinoSegment (src/render/props.ts).
      mask: seg.mask as LayerMask | undefined,
      effects: seg.effects as LayerEffect[] | undefined,
      blend: seg.blend as BlendMode | undefined,
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
    if (seg.kind === "video") {
      const shot = pickShot(appIdx, seg.shot as Shot | undefined);
      const isVideo = /\.(mp4|mov)$/i.test(seg.source ?? "");
      const transition = pickTransition(appIdx, seg.transition as Transition | undefined, isVideo);
      appIdx++;
      return {
        ...base,
        shot,
        transition,
        transitionParams: seg.transitionParams,
        transitionSource: readTransitionSource(seg, project),
        transitionInvert: seg.transitionInvert,
        transitionCamera: seg.transitionCamera,
        carryMotion: seg.carryMotion,
        clipFrom: seg.clipFrom,
        clipTo: seg.clipTo,
        speed: seg.speed,
        pauseAt: seg.pauseAt,
        frame: seg.frame,
        regionShader: seg.regionShader ? resolveRegionShader(seg.regionShader, project, stageAsset) : undefined,
        kickerKeyframes: seg.kickerKeyframes,
        zoomKeyframes: seg.zoomKeyframes,
        kicker: seg.kicker
          ? { text: seg.kicker.text, color: c[KICKER_SLOT[seg.kicker.color]], fg: kickerFg(c[KICKER_SLOT[seg.kicker.color]], c) }
          : undefined,
        motionOverlay: seg.motionOverlay
          ? { ...resolveMotionGraphic(anchorMotion(seg.motionOverlay, `segment[${i}].motionOverlay`), project), words: motionWords }
          : undefined,
      };
    }
    if (seg.kind === "scene") {
      return {
        ...base,
        shot: seg.shot as Shot | undefined,
        motionOverlay: seg.motionOverlay
          ? { ...resolveMotionGraphic(anchorMotion(seg.motionOverlay, `segment[${i}].motionOverlay`), project), words: motionWords }
          : undefined,
      };
    }
    // motion segment: resolve the full-screen graphic; VO drives its duration like other beats.
    return {
      ...base,
      transition: seg.transition,
      transitionParams: seg.transitionParams,
      transitionSource: readTransitionSource(seg, project),
      transitionInvert: seg.transitionInvert,
      transitionCamera: seg.transitionCamera,
      carryMotion: seg.carryMotion,
      motion: {
        ...resolveMotionGraphic(
          anchorMotion({ source: seg.source, params: seg.params, keyframes: seg.keyframes, triggers: seg.triggers, loop: seg.loop }, `segment[${i}]`),
          project,
        ),
        words: motionWords,
      },
      motionOverlay: seg.motionOverlay
        ? { ...resolveMotionGraphic(anchorMotion(seg.motionOverlay, `segment[${i}].motionOverlay`), project), words: motionWords }
        : undefined,
    };
  });

  const props: KinoProps = {
    theme: {
      font: themeFont,
      fontUrl,
      fontFaces: fontFaces.length ? fontFaces : null,
      labelFont: themeLabelFont,
      labelFontUrl,
      bg: c.bg,
      accent: c.accent,
      deep: c.deep,
      accent2: c.accent2,
      fg: c.fg,
      brandName: brand.name,
      captionFontSize: brand.captionStyle.fontSize,
      captionStroke: brand.captionStyle.strokeWidth,
      captionBg: resolveCaptionBackplate(brand.captionStyle.background, c.bg),
      film: resolveFilm(spec, brand),
    },
    fps: spec.fps ?? 30,
    motionBlur: spec.motionBlur,
    avatar: avatarRel,
    avatarWindows,
    voTrack: "vo.mp3",
    background,
    disclosure: avatarRel ? (brand.presenterDisclosure ?? brand.disclosure) : brand.disclosure,
    sfx,
    music,
    segments: renderSegments,
    layers,
    ...(spec.postFx ? { postFx: spec.postFx as PostFx } : {}),
  };

  return { props, publicDir, formats, project, spec, labelFont, words: vo.words };
}

export async function build(
  specPath: string,
  opts: {
    mock?: boolean; // deprecated alias of draft
    draft?: boolean;
    tts?: boolean;
    real?: boolean;
    avatar?: boolean;
    format?: string;
    provider?: string;
    background?: string;
    font?: string;
    tag?: string;
    project?: string;
    beat?: string; // 1-indexed — render only this segment as its own standalone clip
    quality?: string;
  },
): Promise<string[]> {
  let { props, publicDir, formats, project, spec } = await prepare(specPath, opts);
  // Only a draft is low-quality; a full render — silent (the default) or presenter-less
  // (--no-avatar) — keeps final quality and a clean, untagged filename.
  const { draft, vo: voMode } = resolveBuildAxes(opts);
  const quality = parseQuality(opts.quality);

  // --beat: reduce to a single-segment spec and re-run prepare() on it, so the isolated clip gets
  // its own from-scratch VO/timing pass (segment starts at t=0). Only backgroundKeyframes needs
  // adjusting here — it's absolute on the FULL spec's timeline (unlike caption/kicker/zoom/
  // regionShader keyframes, which are already beat-relative) — so it's filtered to the beat's
  // original window and rebased to it. A 1-segment spec has no "next" for the renderer to
  // crossfade with, so transitions already degrade to a hard cut with no extra work.
  let beatTag: string | undefined;
  if (opts.beat != null) {
    // A one-beat spec keys its VO differently from the full spec, so real VO can neither be
    // synthesised for it (--tts) nor found for it in the cache (--real).
    if (voMode !== "mock") {
      const flag = voMode === "tts" ? "--tts" : "--real";
      throw new Error(`--beat cannot be combined with ${flag} (isolating one beat isn't supported for a real-VO build yet)`);
    }
    const beatNum = Number(opts.beat);
    if (!Number.isInteger(beatNum) || beatNum < 1) throw new Error(`--beat must be a positive integer (got ${opts.beat})`);
    const idx = beatNum - 1;
    const target = props.segments[idx];
    if (!target) throw new Error(`--beat ${beatNum} out of range (spec has ${props.segments.length} beats, 1..${props.segments.length})`);

    const rebase = (kfs: BgKeyframe[] | undefined) =>
      (kfs ?? []).filter((k) => k.at >= target.startSec && k.at <= target.endSec).map((k) => ({ ...k, at: k.at - target.startSec }));

    const reducedSpec: Spec = {
      ...spec,
      segments: [spec.segments[idx]],
      seamlessLoop: false,
      backgroundKeyframes: rebase(spec.backgroundKeyframes),
    };

    const tmpDir = scratchDir("kino-beat-");
    const tmpSpecPath = join(tmpDir, "beat.json");
    writeFileSync(tmpSpecPath, JSON.stringify(reducedSpec));
    try {
      ({ props, publicDir, spec } = await prepare(tmpSpecPath, { ...opts, project: basename(project.projectRoot) }));
    } finally {
      releaseScratch(tmpDir);
    }
    beatTag = `beat${beatNum}${draft ? "-draft" : ""}`;
    log.info(`  · isolating beat ${beatNum} (${target.startSec.toFixed(1)}–${target.endSec.toFixed(1)}s of the full timeline)`);
  }
  // Authored-graphic QA: probe each full-screen motion beat and warn on a frozen or diffusely-animated
  // beat. Shared with `still`/`storyboard` so the authoring loop sees the same findings — that is where
  // they are actionable. Never fails the build (runMotionQa swallows its own errors).
  await runMotionQa({ props, publicDir, format: formats[0] });
  log.step("render");
  // Tag variant renders (explicit --tag, else a --background/--font override, else draft) so a
  // preview or variant never overwrites the shipped default render.
  const autoTag =
    opts.tag ??
    beatTag ??
    opts.background ??
    (opts.font ? opts.font.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : undefined) ??
    (draft ? "draft" : undefined);
  const outName = variantName(spec.title, autoTag);
  // Drafts are previews — fast encode preset and a 720p-class canvas; full renders keep the
  // final quality and the format's own resolution.
  const outs = await renderVideo({ props, publicDir, formats, outDir: project.outDir(spec.title), title: outName, preset: draft ? "veryfast" : "medium", quality, draft });
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
